// Local fork of Base mainnet for end-to-end tests. Nothing here touches the real chain.
module.exports = {
  networks: {
    hardhat: {
      chainId: 8453,
      hardfork: 'cancun',
      forking: { url: process.env.FORK_URL || 'https://mainnet.base.org' },
      chains: { 8453: { hardforkHistory: { cancun: 0 } } },
    },
  },
};
