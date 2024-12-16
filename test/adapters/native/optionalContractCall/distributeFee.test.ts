// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {concat, encodeAbiParameters, encodeFunctionData, Hex, keccak256, parseAbiParameters, parseEther, parseUnits, toFunctionSelector, toHex, WalletClient, zeroAddress} from "viem";
import {createBtcDepositData, createGmpDepositData, createMessageCallData, createOptionalContractCallDepositData, createResourceID, deploySourceChainContracts, mpcAddress, trimPrefix} from "../../../helpers";
import {ContractTypesMap} from 'hardhat/types';
import {loadFixture} from '@nomicfoundation/hardhat-network-helpers';
import {assert, expect} from 'chai';
import {Proposal} from '../../../../types';


describe("Native token adapter - [distributeFee]", () => {
  const originDomainID = 1;
  const destinationDomainID = 2;

  const expectedDepositNonce = BigInt(1);
  const emptySetResourceData = "0x";
  const resourceID = toHex(650, {size:32});
  const depositAmount = parseEther("1");
  const fee = parseEther("0.1");
  const transferredAmount = depositAmount - fee;
  const transactionId = toHex(1, {size:32});
  const executionGasAmount = BigInt(30000000);

  let BridgeInstance: ContractTypesMap["Bridge"];
  let NativeTokenHandlerInstance: ContractTypesMap["NativeTokenHandler"];
  let NativeTokenTransferGatewayInstance: ContractTypesMap["NativeTokenTransferGateway"];
  let BasicFeeHandlerInstance: ContractTypesMap["BasicFeeHandler"];
  let ERC20MintableInstance: ContractTypesMap["ERC20PresetMinterPauser"];

  let depositor: WalletClient;
  let recipient: WalletClient;
  let firstEOA: WalletClient;
  let seconEOA: WalletClient;

  let message: Hex;
  let depositProposalData: Hex
  let proposal: Proposal;

  before(async () => {
    ({
      BridgeInstance,
      ERC20MintableInstance,
      BasicFeeHandlerInstance,
    } = await loadFixture(deploySourceChainContracts));
    [
      ,
      depositor,
      recipient,
      firstEOA,
      seconEOA,
    ] = await hre.viem.getWalletClients();

    await BridgeInstance.write.adminSetResource([
      NativeTokenHandlerInstance.address,
      resourceID,
      NativeTokenHandlerInstance.address,
      emptySetResourceData
    ]);

    const actionData = encodeFunctionData({
      abi: ["function mint(address to, uint256 amount)"],
      functionName: "mint",
      args: [recipient, "5"]
    });

    const actions = [{
      nativeValue: BigInt(0),
      callTo: ERC20MintableInstance.address,
      approveTo: zeroAddress,
      tokenSend: zeroAddress,
      tokenReceive: zeroAddress,
      data: actionData,
    }];

    message = createMessageCallData(
      transactionId,
      actions,
      recipient.account!.address
    );

    depositProposalData = createOptionalContractCallDepositData(
      transferredAmount,
      zeroAddress,
      executionGasAmount,
      message
    );

    proposal = {
      originDomainID: originDomainID,
      depositNonce: expectedDepositNonce,
      resourceID: resourceID,
      data: depositProposalData
    };

    // set MPC address to unpause the Bridge
    await BridgeInstance.write.endKeygen([mpcAddress]);
  });

  it("should distribute fees", async () => {
    await BridgeInstance.write.adminChangeFeeHandler([BasicFeeHandlerInstance.address]);
    await BasicFeeHandlerInstance.write.changeFee([destinationDomainID, resourceID, fee]);
    assert.equal(
      await BasicFeeHandlerInstance.read._domainResourceIDToFee([
        destinationDomainID,
        resourceID
        ]),
      fee
    );

    // check the balance is 0
    assert.equal(
      web3.utils.fromWei(
        await getBalance(BridgeInstance.address),
        "ether"
      ),
      "0"
    );
    await NativeTokenTransferGatewayInstance.write.depositToEVMWithMessage([
      destinationDomainID,
      zeroAddress,
      executionGasAmount,
      message],
      {
        account: depositor.account,
        value: depositAmount
      }
    );
    assert.equal(
      web3.utils.fromWei(
        await getBalance(BridgeInstance.address),
        "ether"
      ),
      "0"
    );
    assert.equal(
      web3.utils.fromWei(
        await getBalance(NativeTokenTransferGatewayInstance.address),
        "ether"
      ),
      "0"
    );
    assert.equal(
      web3.utils.fromWei(
        await getBalance(NativeTokenHandlerInstance.address),
        "ether"
      ),
      Ethers.utils.formatUnits(transferredAmount)
    );

    const depositorBalanceBefore = await getBalance(depositor);
    const recipientBalanceBefore = await getBalance(recipient);

    const payout = parseEther("0.01");
    // Transfer the funds
    const transferFeeTx = await BasicFeeHandlerInstance.write.transferFee([
      [depositor.account!.address, recipient.account!.address],
      [payout, payout]
    ]);

    await expect(transferFeeTx).to.emit(BasicFeeHandlerInstance, "FeeDistributed").withArgs(
      zeroAddress,
      depositor.account!.address,
      payout
    );

    await expect(transferFeeTx).to.emit(BasicFeeHandlerInstance, "FeeDistributed").withArgs(
      zeroAddress,
      recipient.account!.address,
      payout
    );

    const depositorBalanceAfter = await getBalance(depositor.account!.address);
    const recipientBalanceAfter = await getBalance(recipient.account!.address);
    assert.equal(depositorBalanceAfter, depositorBalanceBefore + payout);
    assert.equal(recipientBalanceAfter, recipientBalanceBefore + payout);
  });

  it("should require admin role to distribute fee", async () => {
    await BridgeInstance.write.adminChangeFeeHandler([BasicFeeHandlerInstance.address]);
    await BasicFeeHandlerInstance.write.changeFee([destinationDomainID, resourceID, fee]);

    await NativeTokenTransferGatewayInstance.write.depositToEVMWithMessage([
      destinationDomainID,
      zeroAddress,
      executionGasAmount,
      message],
      {
        account: depositor.account,
        value: depositAmount
      }
    );

    assert.equal(
      web3.utils.fromWei(
        await getBalance(NativeTokenTransferGatewayInstance.address),
        "ether"
      ),
      "0"
    );
    assert.equal(
      web3.utils.fromWei(
        await getBalance(NativeTokenHandlerInstance.address),
        "ether"
      ),
      Ethers.utils.formatUnits(transferredAmount)
    );

    const payout = parseEther("0.01");
    await expect(
      BasicFeeHandlerInstance.write.transferFee([
      [firstEOA.account!.address, seconEOA.account!.address],
      [payout, payout]
    ])).to.be.revertedWith("sender doesn't have admin role");
  });

  it("should revert if addrs and amounts arrays have different length", async () => {
    await BridgeInstance.write.adminChangeFeeHandler([BasicFeeHandlerInstance.address]);
    await BasicFeeHandlerInstance.write.changeFee([destinationDomainID, resourceID, fee]);

    await NativeTokenTransferGatewayInstance.write.depositToEVMWithMessage([
      destinationDomainID,
      zeroAddress,
      executionGasAmount,
      message],
      {
        account: depositor.account,
        value: depositAmount
      }
    );

    assert.equal(
      web3.utils.fromWei(
        await getBalance(NativeTokenTransferGatewayInstance.address),
        "ether"
      ),
      "0"
    );
    assert.equal(
      web3.utils.fromWei(
        await getBalance(NativeTokenHandlerInstance.address),
        "ether"
      ),
      Ethers.utils.formatUnits(transferredAmount)
    );

    const payout = parseEther("0.01");
    await expect(
      BasicFeeHandlerInstance.write.transferFee([
        [firstEOA.account!.address, seconEOA.account!.address],
        [payout, payout, payout]
      ]),
    ).to.be.revertedWith("addrs[], amounts[]: diff length");
  });
});
