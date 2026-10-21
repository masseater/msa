import type systemThemeTypes from "./system-theme.types.ts";
import type themeTypes from "./theme.types.ts";

const LEVELS: Record<
  systemThemeTypes.Level,
  Record<themeTypes.ThemeAppearance, systemThemeTypes.Curve>
> = {
  emphasis: {
    dark: {
      coefficients: [0.7303, 0.07695, -1.31626, 7.1681, -10.14436, 4.92846],
      reachable: [0, 0.712],
    },
    light: {
      coefficients: [-4948.31942, 26870.91986, -58334.48399, 63280.17197, -34298.01053, 7430.30146],
      reachable: [0.811, 1],
    },
  },
  panel: {
    dark: {
      coefficients: [0.29131, -0.39746, 2.33185, -0.85524, -1.2076, 0.86276],
      reachable: [0, 0.979],
    },
    light: {
      coefficients: [-3.74073, 27.94549, -78.44258, 112.6798, -79.60015, 22.11277],
      reachable: [0.348, 1],
    },
  },
  readable: {
    dark: {
      coefficients: [0.66937, 0.04704, -1.06871, 6.43941, -8.9332, 4.17229],
      reachable: [0, 0.77],
    },
    light: {
      coefficients: [-1554.52576, 8733.56817, -19604.93507, 21977.72696, -12300.99599, 2749.81288],
      reachable: [0.751, 1],
    },
  },
  subtle: {
    dark: {
      coefficients: [0.56762, -0.02475, -0.5383, 5.12628, -7.10931, 3.17324],
      reachable: [0, 0.848],
    },
    light: {
      coefficients: [-232.85459, 1376.54473, -3249.11801, 3827.91186, -2248.29472, 526.55751],
      reachable: [0.657, 1],
    },
  },
  text: {
    dark: {
      coefficients: [0.89242, 0.02311, -0.44862, 2.34417, -0.06084, -2.63844],
      reachable: [0, 0.5],
    },
    light: {
      coefficients: [-2004.67048, 6664.47299, -6060.70202, -1792.61209, 5133.82359, -1939.85583],
      reachable: [0.894, 1],
    },
  },
  textOnPanel: {
    dark: {
      coefficients: [0.86713, 0.05232, -0.89428, 4.79014, -5.5432, 1.75023],
      reachable: [0, 0.542],
    },
    light: {
      coefficients: [-8570.89457, 43954.60805, -90084.00702, 92220.6791, -47152.15802, 9632.27113],
      reachable: [0.867, 1],
    },
  },
  thinking0: {
    dark: {
      coefficients: [0.52988, -0.05809, -0.30924, 4.63567, -6.52933, 2.89108],
      reachable: [0, 0.873],
    },
    light: {
      coefficients: [-28.27749, 182.85284, -469.62416, 603.15916, -384.59976, 97.35147],
      reachable: [0.51, 1],
    },
  },
  thinking1: {
    dark: {
      coefficients: [0.55278, -0.03667, -0.45659, 4.95347, -6.90265, 3.0706],
      reachable: [0, 0.858],
    },
    light: {
      coefficients: [-37.10484, 235.86282, -596.62344, 754.3633, -474.00763, 118.3551],
      reachable: [0.535, 1],
    },
  },
  thinking2: {
    dark: {
      coefficients: [0.57486, -0.01765, -0.58987, 5.25227, -7.27175, 3.25532],
      reachable: [0, 0.842],
    },
    light: {
      coefficients: [-59.89653, 377.05024, -945.07843, 1182.03145, -734.96375, 181.68658],
      reachable: [0.556, 1],
    },
  },
  thinking3: {
    dark: {
      coefficients: [0.59621, -0.00062, -0.71148, 5.53588, -7.6392, 3.44606],
      reachable: [0, 0.827],
    },
    light: {
      coefficients: [-72.07122, 445.84082, -1099.57352, 1353.88793, -829.53392, 202.26164],
      reachable: [0.58, 1],
    },
  },
  thinking4: {
    dark: {
      coefficients: [0.61691, 0.01462, -0.82288, 5.80651, -8.00641, 3.64333],
      reachable: [0, 0.811],
    },
    light: {
      coefficients: [-110.14338, 674.21488, -1645.75941, 2004.32367, -1215.15899, 293.3183],
      reachable: [0.6, 1],
    },
  },
  thinking5: {
    dark: {
      coefficients: [0.63702, 0.02826, -0.92498, 6.06465, -8.37246, 3.84651],
      reachable: [0, 0.795],
    },
    light: {
      coefficients: [-175.47701, 1063.54495, -2570.70594, 3098.80776, -1860.15527, 444.76392],
      reachable: [0.62, 1],
    },
  },
  thinking6: {
    dark: {
      coefficients: [0.65658, 0.04044, -1.01835, 6.30989, -8.73529, 4.05439],
      reachable: [0, 0.779],
    },
    light: {
      coefficients: [-183.81712, 1094.70055, -2602.68539, 3088.71276, -1826.91131, 430.75931],
      reachable: [0.643, 1],
    },
  },
  thumb: {
    dark: {
      coefficients: [0.60323, 0.00278, -0.73328, 5.57157, -7.68067, 3.46933],
      reachable: [0, 0.823],
    },
    light: {
      coefficients: [-82.89897, 511.01355, -1255.98095, 1540.76821, -940.68087, 228.58523],
      reachable: [0.586, 1],
    },
  },
  track: {
    dark: {
      coefficients: [0.39028, -0.23015, 0.83573, 2.43829, -4.38292, 2.01582],
      reachable: [0, 0.946],
    },
    light: {
      coefficients: [-5.24921, 38.37322, -107.28833, 152.10005, -106.17127, 29.18061],
      reachable: [0.368, 1],
    },
  },
};

const READABLE_FLOOR: Record<themeTypes.ThemeAppearance, systemThemeTypes.Level> = {
  dark: "readable",
  light: "subtle",
};

function levelTarget(
  level: systemThemeTypes.Level,
  appearance: themeTypes.ThemeAppearance,
  surfaceL: number,
): number | undefined {
  const curve = LEVELS[level][appearance];
  if (surfaceL < curve.reachable[0] || surfaceL > curve.reachable[1]) return undefined;
  return curve.coefficients.reduce(
    (sum, coefficient, power) => sum + coefficient * surfaceL ** power,
    0,
  );
}

function lightnessTarget(appearance: themeTypes.ThemeAppearance): systemThemeTypes.LightnessTarget {
  const extreme = appearance === "dark" ? 1 : 0;
  return (level, surfaceL, relaxation) => {
    const reached = levelTarget(level, appearance, surfaceL);
    if (reached === undefined && relaxation === 0) return undefined;
    const distance = (reached ?? extreme) - surfaceL;
    const floor =
      (levelTarget(READABLE_FLOOR[appearance], appearance, surfaceL) ?? extreme) - surfaceL;
    const compressed =
      Math.abs(distance) > Math.abs(floor)
        ? distance - (distance - floor) * Math.min(relaxation, 1)
        : distance;
    return surfaceL + compressed * (1 - Math.max(0, relaxation - 1));
  };
}

const systemThemeLevels = {
  FOREGROUND_LEVEL: "emphasis" as systemThemeTypes.Level,
  lightnessTarget,
};

export default systemThemeLevels;
