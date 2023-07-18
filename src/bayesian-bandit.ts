import { Bandit } from 'bayesian-bandit';

Bandit.prototype.orderedArms = function orderedArms() {
  return this.arms
    .map((arm, index) => ({
      index,
      sample: arm.sample()
    }))
    .sort((a, b) => b.sample - a.sample)
    .map(({ index }) => index);
};

export { Bandit };
