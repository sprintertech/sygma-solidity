// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {parseEther, Hex, WalletClient, zeroAddress} from "viem";
import {createERCDepositData, deploySourceChainContracts, mpcAddress} from "../../../helpers";
import {ContractTypesMap} from "hardhat/types";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {assert, expect} from 'chai';

const Helpers = require("../../../helpers");

describe("BasicFeeHandler - [distributeFee]", () => {
  const originDomainID = 1;
  const destinationDomainID = 2;

  const depositAmount = BigInt(10);
  const feeData = "0x";
  const emptySetResourceData = "0x";

  let BridgeInstance: ContractTypesMap["Bridge"];
  let ERC20MintableInstance: ContractTypesMap["ERC20PresetMinterPauser"];
  let DefaultMessageReceiverInstance: ContractTypesMap["DefaultMessageReceiver"];
  let ERC20HandlerInstance: ContractTypesMap["ERC20Handler"];
  let BasicFeeHandlerInstance: ContractTypesMap["BasicFeeHandler"];
  let FeeHandlerRouterInstance: ContractTypesMap["FeeHandlerRouter"];

  let resourceID: Hex;
  let depositData: Hex;

  let depositor: WalletClient;
  let recipient: WalletClient;

  beforeEach(async () => {
    ({
      BridgeInstance,
      ERC20MintableInstance,
      ERC20HandlerInstance,
      BasicFeeHandlerInstance,
    } = await loadFixture(deploySourceChainContracts));
    [
      ,
      depositor,
      recipient,
    ] = await hre.viem.getWalletClients();

    resourceID = createResourceID(
      ERC20MintableInstance.address,
      originDomainID
    );

    await ERC20MintableInstance.write.mint([depositor.account!.address, depositAmount]);
    await BridgeInstance.write.adminSetResource([
      ERC20HandlerInstance.address,
      resourceID,
      ERC20MintableInstance.address,
      emptySetResourceData
    ]);

    await ERC20MintableInstance.write.approve([
      ERC20HandlerInstance.address,
      depositAmount
    ],
      {
        account: depositor.account
      }
    );

    depositData = createERCDepositData(
      depositAmount,
      20,
      recipient.account!.address
    );

    // set MPC address to unpause the Bridge
    await BridgeInstance.write.endKeygen([mpcAddress]);
  });

  it("should distribute fees", async () => {
    await BridgeInstance.write.adminChangeFeeHandler([BasicFeeHandlerInstance.address]);
    await BasicFeeHandlerInstance.write.changeFee([destinationDomainID, resourceID, parseEther("1")]);
    assert.equal(
      await BasicFeeHandlerInstance.read._domainResourceIDToFee([
        destinationDomainID,
        resourceID
      ]),
      parseEther("1"),
    );

    // check the balance is 0
    assert.equal(
      await getBalance(BridgeInstance.address),
      parseEther("0")
    );

    await BridgeInstance.write.deposit([
      destinationDomainID,
      resourceID,
      depositData,
      feeData
    ],
      {
        account: depositor.account,
        value: parseEther("1")
      }
    );
    assert.equal(
      await getBalance(BridgeInstance.address),
      parseEther("0")
    );
    assert.equal(
      await getBalance(BasicFeeHandlerInstance.address),
      parseEther("1")
    );

    const depositorBalanceBefore = await getBalance(depositor);
    const recipientBalanceBefore = await getBalance(recipient);

    const payout = parseEther("0.5");
    // Transfer the funds
    const transferFeeTx = await BasicFeeHandlerInstance.write.transferFee([
      [depositor.account!.address, recipient.account!.address],
      [payout, payout]
    ]);

    await expect(transferFeeTx).to.emit(BasicFeeHandlerInstance, "FeeDistributed").withArgs(
      zeroAddress,
      depositor.account!.address,
      payout.toString()
    );

    await expect(transferFeeTx).to.emit(BasicFeeHandlerInstance, "FeeDistributed").withArgs(
      zeroAddress,
      recipient.account!.address,
      payout.toString()
    );

    const depositorBalanceAfter = await getBalance(depositor.account!.address);
    const recipientBalanceAfter = await getBalance(recipient.account!.address);
    assert.equal(depositorBalanceAfter, depositorBalanceBefore + payout);
    assert.equal(recipientBalanceAfter, recipientBalanceBefore + payout);
  });

  it("should require admin role to distribute fee", async () => {
    await BridgeInstance.write.adminChangeFeeHandler([BasicFeeHandlerInstance.address]);
    await BasicFeeHandlerInstance.write.changeFee([destinationDomainID, resourceID, parseEther("1")]);

    await BridgeInstance.write.deposit([
      destinationDomainID,
      resourceID,
      depositData,
      feeData
    ],
      {
        account: depositor.account,
        value: parseEther("1")}
    );

    assert.equal(
      await getBalance(BasicFeeHandlerInstance.address),
      parseEther("1")
    );

    const payout = parseEther("0.5");
    await expect(BasicFeeHandlerInstance.write.transferFee([
      [depositor.account!.address, recipient.account!.address],
      [payout, payout]
    ])).to.be.revertedWith("sender doesn't have admin role");
  });

  it("should revert if addrs and amounts arrays have different length", async () => {
    await BridgeInstance.write.adminChangeFeeHandler([BasicFeeHandlerInstance.address]);
    await BasicFeeHandlerInstance.write.changeFee([destinationDomainID, resourceID, parseEther("1")]);

    await BridgeInstance.write.deposit([
      destinationDomainID,
      resourceID,
      depositData,
      feeData
    ],
      {
        account: depositor.account,
        value: parseEther("1")
      }
    );

    assert.equal(
      await getBalance(BasicFeeHandlerInstance.address),
      parseEther("1")
    );

    const payout = parseEther("0.5");
    await expect(
      BasicFeeHandlerInstance.write.transferFee([
        [depositor.account!.address, recipient.account!.address],
        [payout, payout, payout]
      ])
    ).to.be.revertedWith("addrs[], amounts[]: diff length");
  });
});
