// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {getAbiItem, Hex, keccak256, toFunctionSelector, toHex, WalletClient, encodeFunctionData} from "viem";
import {createGmpDepositData, createResourceID, deploySourceChainContracts, mpcAddress, createMessageCallData, createOptionalContractCallDepositData} from "../../../helpers";
import {ContractTypesMap} from 'hardhat/types';
import {loadFixture} from '@nomicfoundation/hardhat-network-helpers';
import {assert, expect} from 'chai';


describe("Bridge - [collect fee - erc20 token]", () => {
  const originDomainID = 1;
  const destinationDomainID = 2;

  const expectedDepositNonce = BigInt(1);
  const emptySetResourceData = "0x";
  const resourceID = toHex(650, {size: 32});
  const initialTokenAmount = BigInt(100);
  const depositAmount = BigInt(10);
  const fee = BigInt(100000); // BPS
  const feeAmount = BigInt(1);
  const executionGasAmount = BigInt(30000000);
  const transactionId = toHex(1, {size: 32});
  const feeData = "0x";

  let DefaultMessageReceiverInstance: ContractTypesMap["DefaultMessageReceiver"]
  let BridgeInstance: ContractTypesMap["Bridge"];
  let ERC20MintableInstance: ContractTypesMap["ERC20PresetMinterPauser"];
  let ERC20HandlerInstance: ContractTypesMap["ERC20Handler"];
  let ERC721MintableInstance: ContractTypesMap["ERC721MinterBurnerPauser"];
  let ERC20BasicFeeHandlerInstance: ContractTypesMap["BasicFeeHandler"];
  let ERC721BasicFeeHandlerInstance: ContractTypesMap["BasicFeeHandler"];
  let FeeHandlerRouterInstance: ContractTypesMap["FeeHandlerRouter"];
  let PercentageFeeHandlerInstance: ContractTypesMap["PercentageERC20FeeHandler"];

  let depositor: WalletClient;
  let evmRecipient: WalletClient;

  let message: Hex;
  let depositProposalData: Hex;

  before(async () => {
    ({
      DefaultMessageReceiverInstance,
      BridgeInstance,
      ERC20MintableInstance,
      ERC20HandlerInstance,
      ERC721MintableInstance,
      BasicFeeHandlerInstance: ERC20BasicFeeHandlerInstance,
      BasicFeeHandlerInstance: ERC721BasicFeeHandlerInstance,
      PercentageFeeHandlerInstance
    } = await loadFixture(deploySourceChainContracts));
    [
      ,
      depositor,
      evmRecipient
    ] = await hre.viem.getWalletClients();

    await ERC20MintableInstance.write.mint([depositor.account!.address, initialTokenAmount]);

    await BridgeInstance.write.adminSetResource([
      ERC20HandlerInstance.address,
      resourceID,
      ERC20MintableInstance.address,
      emptySetResourceData
    ]);
    await PercentageFeeHandlerInstance.write.changeFee([destinationDomainID, resourceID, fee]);
    await BridgeInstance.write.adminChangeFeeHandler([FeeHandlerRouterInstance.address]);
    await FeeHandlerRouterInstance.write.adminSetResourceHandler([
      destinationDomainID,
      resourceID,
      PercentageFeeHandlerInstance.address
    ]);

    await DefaultMessageReceiverInstance.write.grantRole([
      await DefaultMessageReceiverInstance.read.SYGMA_HANDLER_ROLE(),
      ERC20HandlerInstance.address
    ]);

    await ERC20MintableInstance.write.approve([
      ERC20HandlerInstance.address,
      depositAmount
    ],
      {
        account: depositor.account
      }
    );

    const actionData = encodeFunctionData({
      abi: ["function mint(address to, uint256 tokenId, string memory _data)"],
      functionName: "mint",
      args: [evmRecipient, "5", ""]
    });

    const actions = [{
      nativeValue: BigInt(0),
      callTo: ERC721MintableInstance.address,
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
      depositAmount,
      zeroAddress,
      executionGasAmount,
      message
    );

    // set MPC address to unpause the Bridge
    await BridgeInstance.write.endKeygen([mpcAddress]);
  });

  it("ERC20 token transfer fee should be successfully deducted", async () => {
    const depositorBalanceBefore = await ERC20MintableInstance.read.balanceOf([depositor.account!.address]);
    const handlerBalanceBefore = await ERC20MintableInstance.read.balanceOf([ERC20HandlerInstance.address]);

    await expect(
      BridgeInstance.write.deposit([
        destinationDomainID,
        resourceID,
        message,
        feeData
      ],
        {
          account: depositor.account,
        }
      )).not.to.be.reverted;

    // check that correct ERC20 token amount is successfully transferred to the handler
    const handlerBalanceAfter = await ERC20MintableInstance.read.balanceOf([ERC20HandlerInstance.address]);
    assert.strictEqual(
      handlerBalanceBefore + feeAmount,
      handlerBalanceAfter
    );

    // check that depositor before and after balances align
    const depositorBalanceAfter = await ERC20MintableInstance.read.balanceOf([depositor.account!.address]);
    assert.strictEqual(
      depositorBalanceBefore - feeAmount,
      depositorBalanceAfter
    )
  });
});
