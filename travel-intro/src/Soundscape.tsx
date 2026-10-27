import { Audio } from "@remotion/media";
import {
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const layers = [
  {
    name: "Ocean air - continuous quiet bed",
    file: "sea-waves.wav",
    from: 0,
    duration: 12,
    trim: 1,
    times: [0, 0.3, 4.1, 5.2, 10.3, 11.9],
    levels: [0, 0.12, 0.12, 0.14, 0.14, 0],
  },
  {
    name: "Turquoise bay - soft water",
    file: "sea-waves.wav",
    from: 0,
    duration: 1.9,
    trim: 8,
    times: [0, 0.25, 1.4, 1.9],
    levels: [0, 0.2, 0.2, 0],
  },
  {
    name: "Alps - mountain breeze",
    file: "mountain-wind.wav",
    from: 1.4,
    duration: 1.6,
    trim: 4,
    times: [1.4, 1.7, 2.55, 3],
    levels: [0, 0.22, 0.22, 0],
  },
  {
    name: "Alps - distant birds",
    file: "forest-birds.wav",
    from: 1.5,
    duration: 1.5,
    trim: 2,
    times: [1.5, 1.8, 2.5, 3],
    levels: [0, 0.25, 0.25, 0],
  },
  {
    name: "Italian harbour - distant waterfront life",
    file: "waterfront-people.wav",
    from: 2.5,
    duration: 1.5,
    trim: 3,
    times: [2.5, 2.85, 3.55, 4],
    levels: [0, 0.6, 0.6, 0],
  },
  {
    name: "Golden-hour shore - gentle surf swell",
    file: "sea-waves.wav",
    from: 3.5,
    duration: 2.4,
    trim: 4,
    times: [3.5, 3.9, 4.5, 5.9],
    levels: [0, 0.14, 0.14, 0],
  },
  {
    name: "Logo - soft air release",
    file: "soft-air.wav",
    from: 4.5,
    duration: 2.3,
    trim: 0,
    times: [4.5, 4.6, 5.4, 6.8],
    levels: [0, 0.045, 0.035, 0],
  },
  {
    name: "Wordmark - delicate chime",
    file: "soft-chime.wav",
    from: 7.5,
    duration: 1.6,
    trim: 0,
    times: [7.5, 7.55, 8.1, 9.1],
    levels: [0, 0.14, 0.1, 0],
  },
];

export const Soundscape = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <>
      {layers.map((layer) => (
        <Audio
          key={layer.name}
          name={layer.name}
          src={staticFile(`audio/${layer.file}`)}
          from={Math.round(layer.from * fps)}
          durationInFrames={Math.round(layer.duration * fps)}
          trimBefore={Math.round(layer.trim * fps)}
          volume={interpolate(
            frame,
            layer.times.map((time) => time * fps),
            layer.levels,
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
          )}
        />
      ))}
    </>
  );
};
