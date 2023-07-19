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

Bandit.prototype.removeArm = function removeArm(index) {
  if (this.arms.length > 1 && this.arms[index]) {
    this.arms.splice(index, 1);
  }
  return this;
};

export { Bandit };
