import * as dotenv from "dotenv";
import type { HardhatUserConfig } from "hardhat/config";
import "@nomiclabs/hardhat-solhint";
import "hardhat-chai-matchers-viem";
import "hardhat-gas-reporter"


dotenv.config();

const config: HardhatUserConfig = {
  networks: {
    hardhat: {
      forking: {
        url: `${process.env.FORKED_TESTS_PROVIDER}`
      }
    },
  },
  solidity: "0.8.11",
  gasReporter: {
    L1: "ethereum"
  }
};

export default config;
