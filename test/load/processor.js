/* eslint-disable @typescript-eslint/no-var-requires */

const addresses = [
  '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
  '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
  '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
  '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
  '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65'
];
const testNets = [].concat(
  ['5', '31', '65', '97', '280', '599', '647', '1001'],
  ['1287', '4690', '5851', '12357', '22040', '43113', '59140'],
  ['60001', '71401', '84531', '666666', '1666700000', '11297108099']
);
// const testNets = ['5'];

async function getBalance(userContext, events, done) {
  userContext.vars.network = testNets[Math.floor(Math.random() * testNets.length)];
  userContext.vars.address = addresses[Math.floor(Math.random() * addresses.length)];

  return done();
}

module.exports = {
  getBalance
};
