import React, { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View, Text, Dimensions } from "react-native";
import Svg, { Defs, LinearGradient, Stop, Rect, Path, Circle } from "react-native-svg";

// Optional: native splash handoff. Wrapped in try/catch so the component still
// works even if expo-splash-screen isn't installed.
let SplashScreen = null;
try { SplashScreen = require("expo-splash-screen"); } catch (e) {}

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

// --- brand tokens (Steel) ---
const STEEL = "#121b27";
const PAPER = "#f3efe6";
const ORANGE = "#ff8a3d";
const NAVY = "#0e1a30";
const J_PATH = "M58 40 L58 60 Q58 71 47 71 Q37 71 36 62";
const J_DASH = 70; // a touch longer than the path so it fully hides, then draws

const WORD = [
  { c: "j", color: PAPER }, { c: "o", color: PAPER }, { c: "n", color: PAPER },
  { c: "t", color: PAPER }, { c: "y", color: PAPER },
  { c: "w", color: ORANGE }, { c: "a", color: ORANGE }, { c: "r", color: ORANGE }, { c: "e", color: ORANGE },
];

/**
 * jontyware animated splash.
 *
 * Props:
 *   onFinish    () => void   called once the animation + brief hold completes
 *   markSize    number       px size of the logo tile (default 132)
 *   fontFamily  string       wordmark font; default uses the system bold face.
 *                            Pass "BricolageGrotesque_800ExtraBold" (or your loaded
 *                            name) for the exact brand look.
 *   animateMark boolean      true = draw the "j" on (use when the native splash is
 *                            background-only). false (default) = mark is shown
 *                            instantly so it matches a static native splash frame,
 *                            and only the wordmark animates in. Seamless either way.
 */
export default function JontywareSplash({
  onFinish,
  markSize = 132,
  fontFamily,
  animateMark = false,
}) {
  const container = useRef(new Animated.Value(1)).current;     // fade-out at the end
  const tile = useRef(new Animated.Value(animateMark ? 0 : 1)).current;
  const draw = useRef(new Animated.Value(animateMark ? 0 : 1)).current; // 0 hidden -> 1 drawn
  const dot = useRef(new Animated.Value(animateMark ? 0 : 1)).current;
  const bar = useRef(new Animated.Value(0)).current;
  const letters = useRef(WORD.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    // hand off from the native splash the moment we're on screen
    if (SplashScreen?.hideAsync) SplashScreen.hideAsync().catch(() => {});

    const markIntro = animateMark
      ? Animated.parallel([
          Animated.timing(tile, { toValue: 1, duration: 600, delay: 100,
            easing: Easing.out(Easing.back(1.4)), useNativeDriver: true }),
          Animated.timing(draw, { toValue: 1, duration: 750, delay: 550,
            easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
          Animated.timing(dot, { toValue: 1, duration: 400, delay: 1150,
            easing: Easing.out(Easing.back(2)), useNativeDriver: false }),
        ])
      : Animated.delay(150);

    const wordIntro = Animated.stagger(
      55,
      letters.map((v) =>
        Animated.timing(v, { toValue: 1, duration: 500,
          easing: Easing.out(Easing.cubic), useNativeDriver: true })
      )
    );

    const barIntro = Animated.timing(bar, { toValue: 1, duration: 1300,
      easing: Easing.inOut(Easing.cubic), useNativeDriver: false });

    Animated.sequence([
      Animated.parallel([
        markIntro,
        Animated.sequence([Animated.delay(animateMark ? 1100 : 200), wordIntro]),
        Animated.sequence([Animated.delay(animateMark ? 1500 : 600), barIntro]),
      ]),
      Animated.delay(450),
      Animated.timing(container, { toValue: 0, duration: 450,
        easing: Easing.in(Easing.cubic), useNativeDriver: true }),
    ]).start(({ finished }) => { if (finished && onFinish) onFinish(); });
  }, []);

  const vb = markSize / 100; // viewBox(100) -> px scale, for the dot radius/centre

  return (
    <Animated.View style={[styles.fill, { opacity: container }]} pointerEvents="none">
      <View style={styles.center}>
        <Animated.View style={{ transform: [{ scale: tile }], opacity: tile }}>
          <Svg width={markSize} height={markSize} viewBox="0 0 100 100">
            <Defs>
              <LinearGradient id="g" x1="12" y1="6" x2="88" y2="94" gradientUnits="userSpaceOnUse">
                <Stop offset="0" stopColor="#ff7a3d" />
                <Stop offset="1" stopColor="#ffb13d" />
              </LinearGradient>
            </Defs>
            <Rect x="6" y="6" width="88" height="88" rx="26" fill="url(#g)" />
            <AnimatedPath
              d={J_PATH}
              fill="none"
              stroke={NAVY}
              strokeWidth={11}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={J_DASH}
              strokeDashoffset={draw.interpolate({ inputRange: [0, 1], outputRange: [J_DASH, 0] })}
            />
            <AnimatedCircle
              cx="58" cy="27"
              r={dot.interpolate({ inputRange: [0, 1], outputRange: [0, 6.4] })}
              fill={NAVY}
              opacity={dot}
            />
          </Svg>
        </Animated.View>

        <View style={styles.word}>
          {WORD.map((l, i) => (
            <Animated.Text
              key={i}
              style={[
                styles.letter,
                fontFamily ? { fontFamily } : { fontWeight: "800" },
                {
                  color: l.color,
                  opacity: letters[i],
                  transform: [{
                    translateY: letters[i].interpolate({ inputRange: [0, 1], outputRange: [16, 0] }),
                  }],
                },
              ]}
            >
              {l.c}
            </Animated.Text>
          ))}
        </View>

        <View style={styles.track}>
          <Animated.View
            style={[styles.fillbar, {
              width: bar.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }),
            }]}
          />
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { ...StyleSheet.absoluteFillObject, backgroundColor: STEEL, zIndex: 999 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 28 },
  word: { flexDirection: "row" },
  letter: { fontSize: 46, letterSpacing: -1.5, lineHeight: 50 },
  track: { width: 168, height: 3, borderRadius: 99, backgroundColor: "rgba(243,239,230,0.12)", overflow: "hidden" },
  fillbar: { height: "100%", borderRadius: 99, backgroundColor: ORANGE },
});
