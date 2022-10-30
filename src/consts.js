const GEN_MIN = 0;
const GEN_MAX = 127;

const DEFAULT_RANGE = [GEN_MIN, GEN_MAX];



const DEFAULT_STEPS_PER_BEAT = 16;  // this would be equivalent to 16 steps (notes?) per beat, so 64 steps per bar
const DEFAULT_BEATS_PER_BAR = 4;
const DEFAULT_BARS_PER_LOOP = 1;

const DEFAULT_STEPS_PER_BAR = DEFAULT_STEPS_PER_BEAT * DEFAULT_BEATS_PER_BAR;

// value functions should work on a one bar cycle
// we should calculate the increment based on number
// of steps in a bar
const DEFAULT_STEP_INCREMENT = 1 / DEFAULT_STEPS_PER_BAR;
const DEFAULT_STEP_INCREMENT_SINE = 1 / DEFAULT_STEPS_PER_BAR;

const DEFAULT_BPM = 120;

const DEFAULT_FPS = DEFAULT_BPM;
const PULSEHZ_DEBUG = true;

export {
    GEN_MIN,
    GEN_MAX,
    DEFAULT_RANGE,
    DEFAULT_STEP_INCREMENT,
    DEFAULT_STEP_INCREMENT_SINE,
    DEFAULT_FPS,
    DEFAULT_STEPS_PER_BEAT,
    DEFAULT_STEPS_PER_BAR,
    DEFAULT_BEATS_PER_BAR,
    DEFAULT_BARS_PER_LOOP,
    DEFAULT_BPM,
    PULSEHZ_DEBUG,
};
