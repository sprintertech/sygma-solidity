// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {encodeFunctionData, formatEther, Hex, parseEther, WalletClient, zeroAddress} from "viem";
import {createMessageCallData, createOptionalContractCallDepositData, deploySourceChainContracts, getBalance, mpcAddress} from "../../../helpers";
import {ContractTypesMap} from 'hardhat/types';
import {loadFixture} from '@nomicfoundation/hardhat-network-helpers';
import {assert, expect} from 'chai';

describe("Bridge - [collect fee - native token]", () => {
  const destinationDomainID = 2;

  const emptySetResourceData = "0x";
  const resourceID = "0x0000000000000000000000000000000000000000000000000000000000000650";
  const depositAmount = parseEther("1");
  const fee = parseEther("0.1");
  const transferredAmount = depositAmount - fee;
  const executionGasAmount = BigInt(30000000);
  const transactionId = "0x0000000000000000000000000000000000000000000000000000000000000001";

  let BridgeInstance: ContractTypesMap["Bridge"];
  let DefaultMessageReceiverInstance: ContractTypesMap["DefaultMessageReceiver"];
  let NativeTokenHandlerInstance: ContractTypesMap["NativeTokenHandler"];
  let ERC20MintableInstance: ContractTypesMap["ERC20PresetMinterPauser"];
  let BasicFeeHandlerInstance: ContractTypesMap["BasicFeeHandler"];
  let FeeHandlerRouterInstance: ContractTypesMap["FeeHandlerRouter"];
  let NativeTokenTransferGatewayInstance: ContractTypesMap["NativeTokenTransferGateway"];

  let depositor: WalletClient;
  let evmRecipient: WalletClient;

  let message: Hex;
  let depositProposalData: Hex;

  beforeEach(async () => {
    ({
      DefaultMessageReceiverInstance,
      BridgeInstance,
      BasicFeeHandlerInstance,
      NativeTokenHandlerInstance,
      ERC20MintableInstance,
      FeeHandlerRouterInstance
    } = await loadFixture(deploySourceChainContracts));
    [
      ,
      depositor,
      evmRecipient
    ] = await hre.viem.getWalletClients();

    await BridgeInstance.write.adminSetResource([
      NativeTokenHandlerInstance.address,
      resourceID,
      zeroAddress,
      emptySetResourceData
    ]);
    await BasicFeeHandlerInstance.write.changeFee([destinationDomainID, resourceID, fee]);
    await BridgeInstance.write.adminChangeFeeHandler([FeeHandlerRouterInstance.address]);
    await FeeHandlerRouterInstance.write.adminSetResourceHandler([
      destinationDomainID,
      resourceID,
      BasicFeeHandlerInstance.address
    ]);

    await ERC20MintableInstance.write.grantRole([
      await ERC20MintableInstance.read.MINTER_ROLE(),
      DefaultMessageReceiverInstance.address
    ]);

    const actionData = encodeFunctionData({
      abi: ["function mint(address to, uint256 tokenId, string memory _data)"],
      functionName: "mint",
      args: [evmRecipient, "5", ""]
    });

    const actions = [{
      nativeValue: BigInt(0),
      callTo: ERC20MintableInstance.address,
      approveTo: zeroAddress,
      tokenSend: zeroAddress,
      tokenReceive: zeroAddress,
      data: actionData,
    }]
    message = createMessageCallData(
      transactionId,
      actions,
      evmRecipient.account!.address
    );

    depositProposalData = createOptionalContractCallDepositData(
      transferredAmount,
      zeroAddress,
      executionGasAmount,
      message
    );

    // set MPC address to unpause the Bridge
    await BridgeInstance.write.endKeygen([mpcAddress]);
  });

  it("Native token fee should be successfully deducted", async () => {
    const depositorBalanceBefore = await getBalance(depositor);
    const adapterBalanceBefore = await getBalance(NativeTokenTransferGatewayInstance);
    const handlerBalanceBefore = await getBalance(NativeTokenHandlerInstance);

    await expect(
      NativeTokenTransferGatewayInstance.write.depositToEVMWithMessage([
        destinationDomainID,
        zeroAddress,
        executionGasAmount,
        message],
        {
          account: depositor.account,
          value: depositAmount,
        }
      )).not.to.be.reverted;

    // check that correct ETH amount is successfully transferred to the adapter
    const adapterBalanceAfter = await getBalance(NativeTokenTransferGatewayInstance);
    const handlerBalanceAfter = await getBalance(NativeTokenHandlerInstance);
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
    expect(depositorBalanceBefore - depositAmount).to.be.within(
      Number(formatEther(depositorBalanceAfter))*0.99,
      Number(formatEther(depositorBalanceAfter))*1.01
    )
  });
});
