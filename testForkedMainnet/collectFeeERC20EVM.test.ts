// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {ContractTypesMap} from 'hardhat/types';
import {abi as FACTORY_ABI, bytecode as FACTORY_BYTECODE} from "@uniswap/v3-core/artifacts/contracts/UniswapV3Factory.sol/UniswapV3Factory.json";
import {abi as POOL_ABI, bytecode as POOL_BYTECODE} from '@uniswap/v3-core/artifacts/contracts/UniswapV3Pool.sol/UniswapV3Pool.json';
import {abi as QUOTER_ABI, bytecode as QUOTER_BYTECODE} from '@uniswap/v3-periphery/artifacts/contracts/lens/Quoter.sol/Quoter.json';
import {BNB_ADDRESS, createERCDepositData, createResourceID, deploySourceChainContracts, gasUsed, getBalance, MATIC_ADDRESS, mpcAddress, WETH_ADDRESS} from '../test/helpers';
import {Hex, parseEther, WalletClient, zeroAddress} from 'viem';
import {loadFixture} from '@nomicfoundation/hardhat-network-helpers';
import {assert, expect} from 'chai';

describe("TwapNativeTokenFeeHandler - [collectFee]", () => {
  const tokenAmount = parseEther("1");
  const emptySetResourceData = "0x";
  const originDomainID = 1;
  const destinationDomainID = 3;
  const gasPrice = BigInt(200000000000);
  const fixedProtocolFee = parseEther("0.001");
  const ProtocolFeeType = {
    None: "0",
    Fixed: "1",
    Percentage: "2"
  }

  let BridgeInstance: ContractTypesMap["Bridge"];
  let DynamicFeeHandlerInstance: ContractTypesMap["TwapNativeTokenFeeHandler"];
  let FeeHandlerRouterInstance: ContractTypesMap["FeeHandlerRouter"];
  let TwapOracleInstance: ContractTypesMap["TwapOracle"];
  let ERC20MintableInstance: ContractTypesMap["ERC20PresetMinterPauser"]
  let ERC20HandlerInstance: ContractTypesMap["ERC20Handler"]
  let UniswapFactoryInstance: ContractTypesMap["IUniswapV3Factory"];
  let QuoterInstance: ContractTypesMap["QuoterInstance"];

  let sender: WalletClient;
  let depositor: WalletClient;
  let recipient: WalletClient;

  let pool_500;
  let pool_3000;
  let pool_10000;
  let resourceID: Hex;
  let depositData: Hex;

  beforeEach(async () => {
    UniswapFactoryInstance = await hre.viem.deployContract("UniswapFactory");
    QuoterInstance = await hre.viem.deployContract("QuoterV2", [UniswapFactoryInstance, WETH_ADDRESS]);
    ({
      BridgeInstance,
      DynamicFeeHandlerInstance,
      FeeHandlerRouterInstance,
      TwapOracleInstance,
      ERC20MintableInstance,
      ERC20HandlerInstance,
    } = await loadFixture(deploySourceChainContracts));
    [
      sender,
      depositor,
      recipient
    ] = await hre.viem.getWalletClients();

    resourceID = createResourceID(
      ERC20MintableInstance.address,
      originDomainID
    );

    UniswapFactoryInstance = new Ethers.ethers.ContractFactory(
      new Ethers.ethers.utils.Interface(FACTORY_ABI), FACTORY_BYTECODE, signer
    );
    pool_500 = await UniswapFactoryInstance.getPool(WETH_ADDRESS, MATIC_ADDRESS, 500);
    pool_500 = await poolFactory.attach(pool_500);
    pool_3000 = await UniswapFactoryInstance.getPool(WETH_ADDRESS, MATIC_ADDRESS, 3000);
    pool_3000 = await poolFactory.attach(pool_3000);
    pool_10000 = await UniswapFactoryInstance.getPool(WETH_ADDRESS, MATIC_ADDRESS, 10000);
    pool_10000 = await poolFactory.attach(pool_10000);

    await TwapOracleInstance.write.setPool([MATIC_ADDRESS, 500, 100]);

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

    await BridgeInstance.write.adminSetResource([
      ERC20HandlerInstance.address,
      resourceID,
      ERC20MintableInstance.address,
      emptySetResourceData
    ]);
    await ERC20MintableInstance.write.mint([depositor.account!.address, tokenAmount]),
    await ERC20MintableInstance.write.approve([ERC20HandlerInstance.address, tokenAmount], {
      account: depositor.account,
    });
    await BridgeInstance.write.adminChangeFeeHandler([FeeHandlerRouterInstance.address]);
    await FeeHandlerRouterInstance.write.adminSetResourceHandler([
      destinationDomainID,
      resourceID,
      DynamicFeeHandlerInstance.address
    ]);

    depositData = createERCDepositData(
      tokenAmount,
      20,
      recipient.account!.address
    );

    // set MPC address to unpause the Bridge
    await BridgeInstance.write.endKeygen([mpcAddress]);
  });

  it("should collect fee in native coins", async () => {
    const feeData = "0x00";
    const dynamicFeeHandlerBalanceBefore = await getBalance(
        DynamicFeeHandlerInstance
    );
    const res = await FeeHandlerRouterInstance.read.calculateFee([
      sender.account!.address,
      originDomainID,
      destinationDomainID,
      resourceID,
      depositData,
      "0x00"
    ]);

    const fee = res[0];
    const depositTx = await BridgeInstance.write.deposit([
      destinationDomainID,
      resourceID,
      depositData,
      feeData],
      {
        account: depositor.account,
        value: fee,
      }
    );

    await expect(depositTx).to.emit(BridgeInstance, "Deposit").withArgs(
      destinationDomainID,
      resourceID.toLowerCase()
    );
    await expect(depositTx).to.emit(DynamicFeeHandlerInstance, "FeeCollected").withArgs(
      depositor,
      originDomainID,
      destinationDomainID,
      resourceID.toLowerCase(),
      fee,
      zeroAddress
    );

    const dynamicFeeHandlerBalanceAfter = await getBalance(
      DynamicFeeHandlerInstance
    );
    assert.equal(dynamicFeeHandlerBalanceAfter, dynamicFeeHandlerBalanceBefore + fee);
  });

  it("deposit should revert if invalid fee (msg.value) amount supplied", async () => {
    const res = await FeeHandlerRouterInstance.read.calculateFee([
      sender.account!.address,
      originDomainID,
      destinationDomainID,
      resourceID,
      depositData,
      "0x00"
    ]);

    const invalidFee  = res[0] / BigInt(2);

    await expect(
      BridgeInstance.write.deposit([
        destinationDomainID,
        resourceID,
        depositData,
        "0x00"
      ],
        {
          account: depositor.account,
          value: invalidFee,
        }
      ),
    ).to.be.revertedWithCustomError(
      BridgeInstance,
      "IncorrectFeeSupplied(uint256)"
    ).withArgs(invalidFee);
  });

  it("deposit should revert if the destination coin's price is 0", async () => {
    const fee = parseEther("1.0");
    await TwapOracleInstance.write.setPrice([MATIC_ADDRESS, BigInt(0)]);

    await expect(
      BridgeInstance.write.deposit([
        destinationDomainID,
        resourceID,
        depositData,
        "0x00"
      ],
        {
          account: depositor.account,
          value: fee,
        }
      ),
    ).to.be.revertedWithCustomError(BridgeInstance, "IncorrectPrice()");
  });

  it("deposit should not revert if exceed fee (msg.value) amount supplied", async () => {
    const exceedFee = parseEther("1.0");

    const depositTx = await BridgeInstance.write.deposit([
      destinationDomainID,
      resourceID,
      depositData,
      "0x00"
    ],
      {
        account: depositor.account,
        value: exceedFee,
      }
    );
    await expect(depositTx).to.emit(BridgeInstance, "Deposit").withArgs(
      destinationDomainID,
      resourceID.toLowerCase()
    );
  });

  it("should successfully change fee handler from FeeRouter to DynamicFeeHandler and collect fee", async () => {
    await BridgeInstance.write.adminChangeFeeHandler([
      DynamicFeeHandlerInstance.address
    ]);

    const dynamicFeeHandlerBalanceBefore = await getBalance(
      DynamicFeeHandlerInstance
    );

    const res = await FeeHandlerRouterInstance.read.calculateFee([
      sender.account!.address,
      originDomainID,
      destinationDomainID,
      resourceID,
      depositData,
      "0x00"
    ]);
    const fee = res[0];

    const depositTx = await BridgeInstance.write.deposit([
      destinationDomainID,
      resourceID,
      depositData,
      "0x00"],
      {
        account: depositor.account,
        value: fee,
      }
    );
    await expect(depositTx).to.emit(BridgeInstance, "Deposit").withArgs(
      destinationDomainID,
      resourceID.toLowerCase()
    );

    await expect(depositTx).to.emit(DynamicFeeHandlerInstance, "FeeCollected").withArgs(
      depositor.account!.address,
      originDomainID,
      destinationDomainID,
      resourceID.toLowerCase(),
      fee,
      zeroAddress
    );
    const dynamicFeeHandlerBalanceAfter = await getBalance(
      DynamicFeeHandlerInstance
    );

    assert.equal(dynamicFeeHandlerBalanceAfter, dynamicFeeHandlerBalanceBefore + fee);
  });
});
