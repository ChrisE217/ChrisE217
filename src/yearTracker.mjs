const currentYear = new Date().getFullYear();
const startOfYear = new Date(`${currentYear}-01-01T00:00:00+00:00`).getTime();
const endOfYear = new Date(`${currentYear}-12-31T23:59:59+00:00`).getTime();

const progressOfThisYear =
  (Date.now() - startOfYear) / (endOfYear - startOfYear);

const progressBarOfThisYear = () => {
  const passedProgressBarIndex = parseInt(progressOfThisYear * 30);
  return `[ ${"█".repeat(passedProgressBarIndex)}${"▁".repeat(
    30 - passedProgressBarIndex
  )} ]`;
};

export default `\⏳ Year progress ${progressBarOfThisYear()} ${(
  progressOfThisYear * 100
).toFixed(2)} %`;
