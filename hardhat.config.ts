import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox-viem";
import "@nomiclabs/hardhat-solhint";
import "hardhat-chai-matchers-viem";
import "hardhat-gas-reporter"

const config: HardhatUserConfig = {
  networks: {
    hardhat: {},
  },
  solidity: "0.8.11",
  gasReporter: {
    L1: "ethereum"
  }
};

export default config;
