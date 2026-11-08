import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Animated, Easing } from 'react-native';
import Svg, {
  Path,
  Rect,
  Mask,
  ClipPath,
  Defs,
  G,
} from 'react-native-svg';

const AnimatedRect = Animated.createAnimatedComponent(Rect);
const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedG = Animated.createAnimatedComponent(G);

const VIEWBOX_W = 1024;
const VIEWBOX_H = 1007;

// --- Tunable constants, all from the HTML preview's final values ---
const BOUNDARY_X = 423; // hard wall between stem mask and bowl mask
const STEM_LEFT = 200; // stem column left edge
const STEM_BOTTOM_Y = 900; // bottom of stem mask, just below foot baseline
const STEM_TOP_Y = 180; // top of stem reveal (overshoots actual stem; solid-p clips)
const STEM_FULL_HEIGHT = STEM_BOTTOM_Y - STEM_TOP_Y;

const FOOT_LEFT_EXT = 80;
const FOOT_RIGHT_EXT = 110;
const FOOT_HEIGHT = 160;

const BOWL_STROKE_WIDTH = 270;

// Phase windows — driven by one continuous eased master t.
// Stem grows over [0, STEM_END]; bowl grows over [BOWL_START, 1].
// Overlap window [BOWL_START, STEM_END] is where both progress in parallel,
// which masks the corner-turn hiccup.
const STEM_END = 0.48;
const BOWL_START = 0.38;

// Camera scale: starts slightly oversized (foreshortened, near-camera) and
// recedes to 1.0. Subtle but sells the "ribbon coming toward viewer" idea.
const CAMERA_SCALE_START = 1.12;

const TOTAL_DURATION_MS = 1200;

// Bowl mask path is parameterized by BOUNDARY_X. Recomputed once at module load.
const BOWL_PATH = (() => {
  const bx = BOUNDARY_X;
  return (
    `M ${bx} 280 ` +
    `C ${bx + 90} 170, ${bx + 250} 130, ${bx + 360} 220 ` +
    `C ${bx + 450} 310, ${bx + 450} 480, ${bx + 350} 570 ` +
    `C ${bx + 230} 640, ${bx + 70} 600, ${bx - 10} 480`
  );
})();

// Bowl path length, computed analytically would be a pain. We use a fixed
// upper bound for stroke-dasharray that overshoots the true length. Any
// value greater than the actual path length works — dashoffset just clamps.
const BOWL_DASH = 2400;

// Final P logo path, copied from logo_svg.svg cream layer. The bowl counter
// is included as a subpath; fill-rule="evenodd" cuts it out.
const P_FILL_PATH =
  'M442.293579,864.256104 C449.513123,875.365662 459.707092,883.183228 470.818604,889.968445 C475.609314,892.893982 480.458496,895.723694 484.925171,898.885132 C456.604309,899.184937 428.639465,899.199585 400.674591,899.207581 C337.421417,899.225647 274.168243,899.240417 210.915070,899.256531 C213.272675,897.556946 215.583557,895.787659 217.996552,894.170776 C225.585114,889.085815 233.679382,884.633057 240.734695,878.898254 C260.342316,862.960205 268.358459,840.926147 270.918335,816.723206 C272.615143,800.680603 273.741150,784.499207 273.800415,768.375061 C274.107361,684.890625 273.910431,601.404480 274.059052,517.919189 C274.112976,487.631317 277.731537,457.762634 286.582031,428.695892 C298.666931,389.006592 322.926727,357.972290 355.483795,333.040344 C377.830109,315.927673 400.497681,299.234680 422.856079,282.137543 C451.154633,260.498108 475.915833,235.157898 500.006927,208.998474 C519.962952,187.329117 540.414978,166.003891 561.984009,145.965027 C582.781799,126.642693 607.096008,112.213997 635.005615,105.291763 C673.456726,95.754974 710.140564,101.481277 744.559082,120.632195 C791.639893,146.828568 823.456970,186.468109 843.210205,236.018906 C867.574585,297.136841 871.633179,359.600342 852.797363,422.890228 C839.837097,466.437927 814.709778,502.408569 781.606934,533.235962 C752.319397,560.510315 719.101013,582.474792 686.400574,605.166443 C676.415588,612.095337 666.047974,618.474121 656.084534,625.432495 C612.088257,656.159424 564.438538,662.604187 513.311707,647.607788 C480.196869,637.894592 451.704193,620.208801 425.216278,597.516724 C424.080292,596.623230 423.454773,596.204407 422.139282,595.323669 C422.139282,597.639709 422.139923,599.231873 422.139160,600.824097 C422.113556,656.077271 421.965149,711.330811 422.146790,766.583252 C422.193237,780.710144 422.776306,794.878967 424.034698,808.946045 C425.351868,823.670166 427.879272,838.269531 434.738708,851.689819 C434.738708,851.689819 434.668823,851.888062 434.794891,852.282471 C435.205750,853.028259 435.490540,853.379517 435.775330,853.730774 C435.882568,854.136047 435.989807,854.541321 436.364960,855.409058 C437.614166,857.371033 438.595428,858.870544 439.576660,860.370056 C439.694550,860.252197 439.812469,860.134277 439.824463,860.482117 C440.576904,862.050659 441.435242,863.153381 442.293579,864.256104 M427.801910,521.030334 C428.320709,520.403381 428.839508,519.776367 429.936188,518.854492 C452.861542,495.690582 475.786865,472.526642 499.028015,449.043640 C501.182251,451.850006 502.664124,453.637177 503.992279,455.532135 C526.310608,487.374939 553.462036,514.437500 585.387024,536.545593 C607.428101,551.809143 631.038635,564.107605 657.604858,569.578003 C687.241821,575.680725 706.234436,564.780640 714.971924,535.783081 C718.742554,523.269409 721.331787,510.246948 722.950256,497.267670 C727.014526,464.674164 725.690979,432.121002 720.061035,399.745758 C711.472839,350.359009 694.752075,304.187897 664.944031,263.480804 C648.253906,240.688095 628.329712,221.184784 602.668579,208.334427 C577.993713,195.977966 552.849731,193.231461 527.133179,204.880539 C509.614044,212.816345 496.429565,226.132996 485.344452,241.263489 C452.808746,285.672760 433.927856,335.683319 425.841431,390.779297 C424.839783,400.188324 423.115265,409.585846 422.965759,419.008392 C422.414703,453.733521 422.382446,488.466888 422.178772,523.197327 C422.174683,523.901184 422.458740,524.606689 422.776611,526.104126 C424.621216,524.103699 425.941101,522.672363 427.087677,521.096313 C427.087677,521.096313 427.231293,521.270569 427.801910,521.030334 z';

const COLORS = {
  field: '#414B26',
  cream: '#F3EAD5',
};

interface Props {
  /**
   * Called when the animation has fully settled. Hand off to the app here.
   */
  onComplete?: () => void;
  /**
   * If true, skip animation and render the final state immediately.
   * Wire to AccessibilityInfo.isReduceMotionEnabled() for a11y.
   */
  reducedMotion?: boolean;
}

export function SplashLogo({ onComplete, reducedMotion = false }: Props) {
  // Single master progress value [0, 1] eased over the full duration.
  // Both stem and bowl masks read from this through their respective windows.
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reducedMotion) {
      progress.setValue(1);
      onComplete?.();
      return;
    }

    Animated.timing(progress, {
      toValue: 1,
      duration: TOTAL_DURATION_MS,
      // easeInOutQuart approximation — Reanimated has Easing.bezier which
      // matches more precisely, but Easing.inOut(Easing.quad) is close enough
      // and ships with React Native's stdlib.
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: false, // SVG attribute animations require JS driver
    }).start(({ finished }) => {
      if (finished) onComplete?.();
    });
  }, [reducedMotion, progress, onComplete]);

  // --- Derived animated values ---

  // Stem progress: 0 → 1 over [0, STEM_END]
  const stemProgress = progress.interpolate({
    inputRange: [0, STEM_END, 1],
    outputRange: [0, 1, 1],
    extrapolate: 'clamp',
  });

  // Bowl progress: 0 → 1 over [BOWL_START, 1]
  const bowlProgress = progress.interpolate({
    inputRange: [0, BOWL_START, 1],
    outputRange: [0, 0, 1],
    extrapolate: 'clamp',
  });

  // Stem mask rectangle: y shrinks (bottom-up reveal), height grows.
  const stemRectHeight = stemProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, STEM_FULL_HEIGHT],
  });
  const stemRectY = stemProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [STEM_BOTTOM_Y, STEM_TOP_Y],
  });

  // Foot mask: same y/height window, but height capped at FOOT_HEIGHT.
  // Implementation: interpolate height with a clamp at FOOT_HEIGHT, and
  // derive y from STEM_BOTTOM_Y - height. The clamp is implicit in the
  // interpolation: once stemProgress passes (FOOT_HEIGHT / STEM_FULL_HEIGHT),
  // height stays at FOOT_HEIGHT.
  const FOOT_PROGRESS_CAP = FOOT_HEIGHT / STEM_FULL_HEIGHT;
  const footRectHeight = stemProgress.interpolate({
    inputRange: [0, FOOT_PROGRESS_CAP, 1],
    outputRange: [0, FOOT_HEIGHT, FOOT_HEIGHT],
    extrapolate: 'clamp',
  });
  const footRectY = stemProgress.interpolate({
    inputRange: [0, FOOT_PROGRESS_CAP, 1],
    outputRange: [STEM_BOTTOM_Y, STEM_BOTTOM_Y - FOOT_HEIGHT, STEM_BOTTOM_Y - FOOT_HEIGHT],
    extrapolate: 'clamp',
  });

  // Bowl dashoffset: BOWL_DASH (fully hidden) → 0 (fully revealed).
  const bowlDashOffset = bowlProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [BOWL_DASH, 0],
  });

  // Camera scale: CAMERA_SCALE_START → 1.0, settled slightly before total ends.
  const cameraScale = progress.interpolate({
    inputRange: [0, 0.92, 1],
    outputRange: [CAMERA_SCALE_START, 1, 1],
    extrapolate: 'clamp',
  });

  const stemRectWidth = BOUNDARY_X - STEM_LEFT;
  const footRectX = STEM_LEFT - FOOT_LEFT_EXT;
  const footRectWidth = (BOUNDARY_X - STEM_LEFT) + FOOT_LEFT_EXT + FOOT_RIGHT_EXT;
  const bowlClipWidth = VIEWBOX_W - BOUNDARY_X;

  return (
    <View style={[styles.container, { backgroundColor: COLORS.field }]}>
      <Animated.View
        style={[
          styles.svgWrap,
          { transform: [{ scale: cameraScale }] },
        ]}
      >
        <Svg viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`} width="80%" height="80%">
          <Defs>
            <ClipPath id="bowl-clip">
              <Rect x={BOUNDARY_X} y={0} width={bowlClipWidth} height={VIEWBOX_H} />
            </ClipPath>
            <Mask
              id="reveal-mask"
              maskUnits="userSpaceOnUse"
              x={0}
              y={0}
              width={VIEWBOX_W}
              height={VIEWBOX_H}
            >
              {/* Black background = nothing revealed by default */}
              <Rect x={0} y={0} width={VIEWBOX_W} height={VIEWBOX_H} fill="black" />

              {/* Foot mask: wider, capped at FOOT_HEIGHT */}
              <AnimatedRect
                x={footRectX}
                y={footRectY}
                width={footRectWidth}
                height={footRectHeight}
                fill="white"
              />

              {/* Stem mask: narrower column, grows full height */}
              <AnimatedRect
                x={STEM_LEFT}
                y={stemRectY}
                width={stemRectWidth}
                height={stemRectHeight}
                fill="white"
              />

              {/* Bowl mask: stroked loop, clipped to right of boundary */}
              <G clipPath="url(#bowl-clip)">
                <AnimatedPath
                  d={BOWL_PATH}
                  stroke="white"
                  strokeWidth={BOWL_STROKE_WIDTH}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  fill="none"
                  strokeDasharray={`${BOWL_DASH}`}
                  strokeDashoffset={bowlDashOffset}
                />
              </G>
            </Mask>
          </Defs>

          <Path
            d={P_FILL_PATH}
            fill={COLORS.cream}
            fillRule="evenodd"
            mask="url(#reveal-mask)"
          />
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  svgWrap: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
