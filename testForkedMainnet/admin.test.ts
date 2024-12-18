// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {ContractTypesMap} from 'hardhat/types';
import {abi as FACTORY_ABI, bytecode as FACTORY_BYTECODE} from "@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json";
import {abi as POOL_ABI, bytecode as POOL_BYTECODE} from '@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json';
import {abi as QUOTER_ABI, bytecode as QUOTER_BYTECODE} from '@uniswap/v3-periphery/artifacts/contracts/lens/Quoter.sol/Quoter.json';
import {deploySourceChainContracts, gasUsed, MATIC_ADDRESS, WETH_ADDRESS} from '../test/helpers';
import {Hex, parseEther, WalletClient, zeroAddress} from 'viem';
import {loadFixture} from '@nomicfoundation/hardhat-network-helpers';
import {assert, expect} from 'chai';


describe("TwapFeeHandler - [admin]", () => {
  let DynamicFeeHandlerInstance: ContractTypesMap["TwapNativeTokenFeeHandler"];
  let FeeHandlerRouterInstance: ContractTypesMap["FeeHandlerRouter"];
  let TwapOracleInstance: ContractTypesMap["TwapOracle"];
  let UniswapFactoryInstance: ContractTypesMap["IUniswapV3Factory"];
  let QuoterInstance: ContractTypesMap["QuoterV2"];

  let feeHandlerAdmin: WalletClient;
  let newDynamicFeeHandlerAdmin: WalletClient;

  let ADMIN_ROLE: Hex;
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
      feeHandlerAdmin,
      newDynamicFeeHandlerAdmin,
    ] = await hre.viem.getWalletClients();

    const poolFactory = new Ethers.ethers.ContractFactory(
      new Ethers.ethers.utils.Interface(POOL_ABI), POOL_BYTECODE, signerAccount
    );
    pool_500 = await UniswapFactoryInstance.read.getPool(WETH_ADDRESS, MATIC_ADDRESS, 500);
    pool_500 = await poolFactory.attach(pool_500);
    pool_3000 = await UniswapFactoryInstance.getPool(WETH_ADDRESS, MATIC_ADDRESS, 3000);
    pool_3000 = await poolFactory.attach(pool_3000);
    pool_10000 = await UniswapFactoryInstance.getPool(WETH_ADDRESS, MATIC_ADDRESS, 10000);
    pool_10000 = await poolFactory.attach(pool_10000);

    ADMIN_ROLE = await DynamicFeeHandlerInstance.read.DEFAULT_ADMIN_ROLE();
  });

  it("should return fee handler type", async () => {
    assert.equal(await DynamicFeeHandlerInstance.read.feeHandlerType(), "twap");
  });

  it("should set fee oracle and emit 'FeeOracleAddressSet' event", async () => {
    assert.equal(
      await DynamicFeeHandlerInstance.read.twapOracle(),
      zeroAddress
    );
    const setFeeOracleAddressTx = await DynamicFeeHandlerInstance.write.setFeeOracle([TwapOracleInstance.address]);
    const newOracle = await DynamicFeeHandlerInstance.read.twapOracle();
    assert.equal(newOracle, TwapOracleInstance.address);

    await expect(setFeeOracleAddressTx).to.emit(DynamicFeeHandlerInstance, "FeeOracleAddressSet").withArgs(
      newOracle
    )
  });

  it("should require admin role to change fee oracle", async () => {
    await expect(
      DynamicFeeHandlerInstance.write.setFeeOracle([
      TwapOracleInstance.address
    ])).to.be.revertedWith("sender doesn't have admin role");
  });

  it("should set fee properties and emit 'FeePropertySet' event", async () => {
    assert.equal(await DynamicFeeHandlerInstance.read._gasUsed(), 0);
    const setFeeOraclePropertiesTx = await DynamicFeeHandlerInstance.write.setFeeProperties([gasUsed]);
    assert.equal(await DynamicFeeHandlerInstance.read._gasUsed(), gasUsed);

    await expect(setFeeOraclePropertiesTx).to.emit(DynamicFeeHandlerInstance, "FeePropertySet").withArgs(
      gasUsed
    );
  });

  it("should require admin role to change fee properties", async () => {
    await expect(
      DynamicFeeHandlerInstance.write.setFeeProperties([
      gasUsed
    ])).to.be.revertedWith("sender doesn't have admin role");
  });

  it("should set pool and emit 'PoolSet' event", async () => {
    const setPoolTx = await TwapOracleInstance.write.setPool([MATIC_ADDRESS, 3000, 100]);
    const pool = await TwapOracleInstance.read.pools([MATIC_ADDRESS]);
    assert.equal(pool[0], pool_3000.address);
    assert.equal(pool[1], 100);

    await expect(setPoolTx).to.emit(TwapOracleInstance, "PoolSet").withArgs(
      MATIC_ADDRESS,
      3000,
      100,
      pool.poolAddress
    );
  });

  it("should require admin role to set pool", async () => {
    await expect(
      TwapOracleInstance.write.setPool([
      MATIC_ADDRESS,
      3000,
      100
    ])).to.be.revertedWith("sender doesn't have admin role");
  });

  it("should set price manually and emit 'PriceSet' event", async () => {
    const new_price = parseEther("0.018");
    const setPriceTx = await TwapOracleInstance.write.setPrice([MATIC_ADDRESS, new_price]);
    const priceOnOracle = await TwapOracleInstance.read.prices([MATIC_ADDRESS]);
    const pool = await TwapOracleInstance.read.pools([MATIC_ADDRESS]);
    assert.equal(pool.poolAddress, zeroAddress);
    assert.equal(pool.timeWindow, 0);
    assert.equal(priceOnOracle.toString(), new_price.toString());

    await expect(setPriceTx).to.emit(TwapOracleInstance, "PriceSet").withArgs(
      MATIC_ADDRESS,
      new_price
    );
  });

  it("should require admin role to set price", async () => {
    const new_price = parseEther("0.018");
    await expect(
      TwapOracleInstance.write.setPrice([
      MATIC_ADDRESS,
      new_price
    ])).to.be.revertedWith("sender doesn't have admin role");
  });

  it("DynamicFeeHandler admin should be changed to newDynamicFeeHandlerAdmin", async () => {
    // check current admin
    assert.isTrue(
      await DynamicFeeHandlerInstance.read.hasRole([
        ADMIN_ROLE,
        feeHandlerAdmin.account!.address
      ])
    );

    await Helpers.passes(
      DynamicFeeHandlerInstance.write.renounceAdmin([
        newDynamicFeeHandlerAdmin.account!.address
      ])
    );
    assert.isTrue(
      await DynamicFeeHandlerInstance.read.hasRole([
        ADMIN_ROLE,
        newDynamicFeeHandlerAdmin.account!.address
      ])
    );

    // check that former admin is no longer admin
    assert.isFalse(
      await DynamicFeeHandlerInstance.read.hasRole([
        ADMIN_ROLE,
        feeHandlerAdmin.account!.address
      ])
    );
  });
});
