// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {deploySourceChainContracts} from "../../../helpers";
import {ContractTypesMap} from 'hardhat/types';
import {Hex, WalletClient} from 'viem';
import {assert} from 'chai';

const Helpers = require("../../../helpers");

describe("PercentageFeeHandler - [calculateFee]", () => {
  const originDomainID = 1;
  const destinationDomainID = 2;
  const feeData = "0x";
  const emptySetResourceData = "0x";
  const fee = BigInt(10000);

  let BridgeInstance: ContractTypesMap["Bridge"];
  let PercentageFeeHandlerInstance: ContractTypesMap["PercentageERC20FeeHandler"];
  let ERC20HandlerInstance: ContractTypesMap["ERC20Handler"];
  let ERC20MintableInstance: ContractTypesMap["ERC20PresetMinterPauser"];
  let FeeHandlerRouterInstance: ContractTypesMap["FeeHandlerRouter"];

  let resourceID: Hex;
  let relayer: WalletClient;
  let recipient: WalletClient;

  before(async () => {
    ({
      BridgeInstance,
      PercentageFeeHandlerInstance,
      ERC20MintableInstance,
    } = await loadFixture(deploySourceChainContracts));
    [
      ,
      relayer,
      recipient,
    ] = await hre.viem.getWalletClients();

    resourceID = createResourceID(
      ERC20MintableInstance.address,
      originDomainID
    );


    await BridgeInstance.write.adminSetResource([
      ERC20HandlerInstance.address,
      resourceID,
      ERC20MintableInstance.address,
      emptySetResourceData
    ]);
    await BridgeInstance.write.adminChangeFeeHandler([FeeHandlerRouterInstance.address]),
    await FeeHandlerRouterInstance.write.adminSetResourceHandler([
      destinationDomainID,
      resourceID,
      PercentageFeeHandlerInstance.address
    ]);
  });

  it(`should return percentage of token amount for fee if bounds
      are set [lowerBound > 0, upperBound > 0]`, async () => {
    const depositData = createERCDepositData(100000000, 20, recipient);

    // current fee is set to 0
    let res = await FeeHandlerRouterInstance.read.calculateFee([
      relayer.account!.address,
      originDomainID,
      destinationDomainID,
      resourceID,
      depositData,
      feeData
    ]);

    assert.equal(res[0], BigInt(0));
    // Change fee to 1 BPS ()
    await PercentageFeeHandlerInstance.write.changeFee([destinationDomainID, resourceID, fee]);
    await PercentageFeeHandlerInstance.write.changeFeeBounds([resourceID, BigInt(100), BigInt(300000)]);
    res = await FeeHandlerRouterInstance.read.calculateFee([
      relayer.account!.address,
      originDomainID,
      destinationDomainID,
      resourceID,
      depositData,
      feeData
    ]);
    assert.equal(res[0], fee);
  });

  it(`should return percentage of token amount for fee if bounds
      are not set [lowerBound = 0, upperBound = 0]`, async () => {
    const depositData = createERCDepositData(100000000, 20, recipient);

    // current fee is set to 0
    let res = await FeeHandlerRouterInstance.read.calculateFee([
      relayer.account!.address,
      originDomainID,
      destinationDomainID,
      resourceID,
      depositData,
      feeData
    ]);

    assert.equal(res[0], BigInt(0));
    // Change fee to 1 BPS ()
    await PercentageFeeHandlerInstance.write.changeFee([destinationDomainID, resourceID, fee]);
    res = await FeeHandlerRouterInstance.read.calculateFee([
      relayer.account!.address,
      originDomainID,
      destinationDomainID,
      resourceID,
      depositData,
      feeData
    ]);
    assert.equal(res[0], fee);
  });

  it("should return lower bound token amount for fee [lowerBound > 0, upperBound > 0]", async () => {
    const depositData = createERCDepositData(fee, 20, recipient);
    await PercentageFeeHandlerInstance.write.changeFeeBounds([resourceID, BigInt(100), BigInt(300)]);
    await PercentageFeeHandlerInstance.write.changeFee([destinationDomainID, resourceID, fee]);

    const res = await FeeHandlerRouterInstance.read.calculateFee([
      relayer.account!.address,
      originDomainID,
      destinationDomainID,
      resourceID,
      depositData,
      feeData
    ]);
    assert.equal(res[0], BigInt(100));
  });

  it("should return lower bound token amount for fee [lowerBound > 0, upperBound = 0]", async () => {
    const depositData = createERCDepositData(fee, 20, recipient);
    await PercentageFeeHandlerInstance.write.changeFeeBounds([resourceID, BigInt(100), BigInt(0)]);
    await PercentageFeeHandlerInstance.write.changeFee([destinationDomainID, resourceID, fee]);

    const res = await FeeHandlerRouterInstance.read.calculateFee([
      relayer.account!.address,
      originDomainID,
      destinationDomainID,
      resourceID,
      depositData,
      feeData
    ]);
    assert.equal(res[0], BigInt(100));
  });

  it("should return upper bound token amount for fee [lowerBound = 0, upperBound > 0]", async () => {
    const depositData = createERCDepositData(100000000, 20, recipient);
    await PercentageFeeHandlerInstance.write.changeFeeBounds([resourceID, BigInt(0), BigInt(300)]);
    await PercentageFeeHandlerInstance.write.changeFee([destinationDomainID, resourceID, fee]);

    const res = await FeeHandlerRouterInstance.read.calculateFee([
      relayer.account!.address,
      originDomainID,
      destinationDomainID,
      resourceID,
      depositData,
      feeData
    ]);
    assert.equal(res[0], BigInt(300));
  });

  it("should return percentage of token amount for fee [lowerBound = 0, upperBound > 0]", async () => {
    const depositData = createERCDepositData(100000, 20, recipient);
    await PercentageFeeHandlerInstance.write.changeFeeBounds([resourceID, BigInt(0), BigInt(300)]);
    await PercentageFeeHandlerInstance.write.changeFee([destinationDomainID, resourceID, fee]);

    const res = await FeeHandlerRouterInstance.read.calculateFee([
      relayer.account!.address,
      originDomainID,
      destinationDomainID,
      resourceID,
      depositData,
      feeData
    ]);
    assert.equal(res[0], BigInt(10));
  });
});
