// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from "hardhat";
import {assert, expect} from "chai";
import {parseEther, formatEther, WalletClient, toHex} from "viem";
import {deploySourceChainContracts, getBalance, mpcAddress} from "../../helpers";
import {ContractTypesMap} from "hardhat/types";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";


describe("Bridge - [collect fee - native token]", () => {
  const originDomainID = 1;
  const destinationDomainID = 2;

  const emptySetResourceData = "0x";
  const resourceID = toHex(650, {size:32});
  const btcrecipient = "bc1qs0fcdq73vgurej48yhtupzcv83un2p5qhsje7n";
  const depositAmount = parseEther("1");
  const fee = parseEther("0.1");
  const transferredAmount = depositAmount - fee;

  let BridgeInstance: ContractTypesMap["Bridge"];
  let DefaultMessageReceiverInstance: ContractTypesMap["DefaultMessageReceiver"];
  let NativeTokenHandlerInstance: ContractTypesMap["NativeTokenHandler"];
  let BasicFeeHandlerInstance: ContractTypesMap["BasicFeeHandler"];
  let FeeHandlerRouterInstance: ContractTypesMap["FeeHandlerRouter"];
  let NativeTokenTransferGatewayInstance: ContractTypesMap["NativeTokenTransferGateway"];

  let depositor: WalletClient;

  before(async () => {
    ({
      DefaultMessageReceiverInstance,
      BridgeInstance,
      NativeTokenHandlerInstance,
      BasicFeeHandlerInstance,
      FeeHandlerRouterInstance,
      NativeTokenTransferGatewayInstance,
    } = await loadFixture(deploySourceChainContracts));
    [
      ,
      depositor,
    ] = await hre.viem.getWalletClients();

    await BridgeInstance.write.adminSetResource([
      NativeTokenHandlerInstance.address,
      resourceID,
      NativeTokenHandlerInstance.address,
      emptySetResourceData
    ]);
    await BasicFeeHandlerInstance.write.changeFee([destinationDomainID, resourceID, fee]);
    await BridgeInstance.write.adminChangeFeeHandler([FeeHandlerRouterInstance.address]);
    await FeeHandlerRouterInstance.write.adminSetResourceHandler([
      destinationDomainID,
      resourceID,
      BasicFeeHandlerInstance.address
    ]);

    // set MPC address to unpause the Bridge
    await BridgeInstance.write.endKeygen([mpcAddress]);
  });

  it("Native token fee should be successfully deducted", async () => {
    const depositorBalanceBefore = await getBalance(depositor);
    const adapterBalanceBefore = await getBalance(NativeTokenTransferGatewayInstance.address);
    const handlerBalanceBefore = await getBalance(NativeTokenHandlerInstance.address);

    await expect(
      NativeTokenTransferGatewayInstance.write.deposit([
        destinationDomainID,
        btcrecipient
      ],
        {
          account: depositor.account,
          value: depositAmount,
        }
      )).not.to.be.reverted;

    // check that correct ETH amount is successfully transferred to the adapter
    const adapterBalanceAfter = await getBalance(NativeTokenTransferGatewayInstance.address);
    const handlerBalanceAfter = await getBalance(NativeTokenHandlerInstance.address);
    assert.strictEqual(
      transferredAmount + handlerBalanceBefore, handlerBalanceAfter
    );

    // check that adapter funds are transferred to the native handler contracts
    assert.strictEqual(
      adapterBalanceBefore,
      adapterBalanceAfter
    );

    // check that depositor before and after balances align
    const depositorBalanceAfter = await getBalance(depositor);
    expect(
      depositorBalanceBefore - depositAmount
    ).to.be.within(
      depositorBalanceAfter*0.99,
      depositorBalanceAfter*1.01
    )
  });
});
