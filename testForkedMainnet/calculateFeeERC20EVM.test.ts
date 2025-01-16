// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {ContractTypesMap} from 'hardhat/types';
import {abi as FACTORY_ABI, bytecode as FACTORY_BYTECODE} from "@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json";
import {abi as POOL_ABI, bytecode as POOL_BYTECODE} from '@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json';
import {abi as QUOTER_ABI, bytecode as QUOTER_BYTECODE} from '@uniswap/v3-periphery/artifacts/contracts/lens/Quoter.sol/Quoter.json';
import {BNB_ADDRESS, deploySourceChainContracts, gasUsed, MATIC_ADDRESS, WETH_ADDRESS} from '../test/helpers';
import {Hex, parseEther, WalletClient, zeroAddress} from 'viem';
import {loadFixture} from '@nomicfoundation/hardhat-network-helpers';
import {assert, expect} from 'chai';


describe("TwapFeeHandler - [calculateFee]", () => {
  const originDomainID = 1;
  const destinationDomainID = 3;
  const gasPrice = 200000000000;
  const ProtocolFeeType = {
    None: "0",
    Fixed: "1",
    Percentage: "2"
  }
  const fixedProtocolFee = parseEther("0.001");
  const feePercentage = 1000; // 10%

  let DynamicFeeHandlerInstance: ContractTypesMap["TwapNativeTokenFeeHandler"];
  let FeeHandlerRouterInstance: ContractTypesMap["FeeHandlerRouter"];
  let TwapOracleInstance: ContractTypesMap["TwapOracle"];
  let ERC20MintableInstance: ContractTypesMap["ERC20PresetMinterPauser"]
  let UniswapFactoryInstance: ContractTypesMap["IUniswapV3Factory"];
  let QuoterInstance: ContractTypesMap["QuoterInstance"];

  let sender: WalletClient;

  let resourceID: Hex;
  let pool_500;
  let pool_3000;
  let pool_10000;

  beforeEach(async () => {
    UniswapFactoryInstance = await hre.viem.deployContract("UniswapFactory");
    QuoterInstance = await hre.viem.deployContract("QuoterV2", [UniswapFactoryInstance, WETH_ADDRESS]);
    ({
      DynamicFeeHandlerInstance,
      FeeHandlerRouterInstance,
      TwapOracleInstance,
    } = await loadFixture(deploySourceChainContracts));
    [
      sender,
      newDynamicFeeHandlerAdmin,
    ] = await hre.viem.getWalletClients();

    resourceID = Helpers.createResourceID(
      ERC20MintableInstance.address,
      originDomainID
    );

    const poolFactory = new Ethers.ethers.ContractFactory(
      new Ethers.ethers.utils.Interface(POOL_ABI), POOL_BYTECODE, signerAccount
    );
    pool_500 = await UniswapFactoryInstance.getPool(WETH_ADDRESS, MATIC_ADDRESS, 500);
    pool_500 = await poolFactory.attach(pool_500);
    pool_3000 = await UniswapFactoryInstance.getPool(WETH_ADDRESS, MATIC_ADDRESS, 3000);
    pool_3000 = await poolFactory.attach(pool_3000);
    pool_10000 = await UniswapFactoryInstance.getPool(WETH_ADDRESS, MATIC_ADDRESS, 10000);
    pool_10000 = await poolFactory.attach(pool_10000);

    TwapOracleInstance = await TwapOracleContract.new(UniswapFactoryInstance.address, WETH_ADDRESS);
    await TwapOracleInstance.setPool([MATIC_ADDRESS, 500, 100]);

    await FeeHandlerRouterInstance.write.adminSetResourceHandler([
      destinationDomainID,
      resourceID,
      DynamicFeeHandlerInstance.address
    ]);
    await DynamicFeeHandlerInstance.write.setFeeOracle([TwapOracleInstance.address]);
    await DynamicFeeHandlerInstance.write.setGasPrice([
      destinationDomainID,
      gasPrice,  // Polygon gas price is 200 Gwei
      ProtocolFeeType.Fixed,
      fixedProtocolFee
    ]);
    await DynamicFeeHandlerInstance.write.setWrapTokenAddress([destinationDomainID, MATIC_ADDRESS]);
    await DynamicFeeHandlerInstance.write.setFeeProperties([gasUsed]);
  });

  it("[fixed protocol fee] should get the correct values", async () => {
    const feeInDestinationToken = gasPrice * gasUsed;
    const res = await FeeHandlerRouterInstance.read.calculateFee([
      sender.account!.address,
      originDomainID,
      destinationDomainID,
      resourceID,
      "0x00",
      "0x00"
    ]);

    const input = new Ethers.ethers.BigNumber.from(feeInDestinationToken.toString());
    const out = await QuoterInstance.callStatic.quoteExactInputSingle(MATIC_ADDRESS, WETH_ADDRESS, 500, input, 0);
    expect(
      (await DynamicFeeHandlerInstance.read.destinationFee([destinationDomainID]))[0]
    ).to.be.equal(ProtocolFeeType.Fixed);
    expect(res[0]).to.be.within(
      out*0.99 + Number(fixedProtocolFee),
      out*1.01 + Number(fixedProtocolFee)
    );
  });

  it("should get the correct price for the tokens with no available pool", async () => {
      const bnb_price = parseEther("0.18");
      await TwapOracleInstance.write.setPrice([BNB_ADDRESS, bnb_price]);
      const priceOnOracle = await TwapOracleInstance.read.getPrice([BNB_ADDRESS]);
      assert.equal(priceOnOracle.toString(), bnb_price.toString());
  });

  it("[percentage protocol fee] should get the correct values", async () => {
    await DynamicFeeHandlerInstance.write.setGasPrice([
      destinationDomainID,
      gasPrice,  // Polygon gas price is 200 Gwei
      ProtocolFeeType.Percentage,
      feePercentage
    ]);

    const feeInDestinationToken = gasPrice * gasUsed;
    const res = await FeeHandlerRouterInstance.read.calculateFee([
      sender.account!.address,
      originDomainID,
      destinationDomainID,
      resourceID,
      "0x00",
      "0x00"
    ]);

    const input = new Ethers.ethers.BigNumber.from(feeInDestinationToken.toString());
    const out = await QuoterInstance.callStatic.quoteExactInputSingle(MATIC_ADDRESS, WETH_ADDRESS, 500, input, 0);
    expect(
      (await DynamicFeeHandlerInstance.read.destinationFee([destinationDomainID]))[0]
    ).to.be.equal(ProtocolFeeType.Percentage);
    expect(res[0]).to.be.within(
      out*1.09,
      out*1.11
    );
  });
});
