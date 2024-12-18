// The Licensed Work is (c) 2022 Sygma

import hre from 'hardhat';
import {ContractTypesMap} from "hardhat/types";
import {createResourceID, deploySourceChainContracts, mpcAddress} from "../../../helpers";
import {Hex, WalletClient} from "viem";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {assert, expect} from 'chai';

// SPDX-License-Identifier: LGPL-3.0-only


describe("PercentageFeeHandler - [distributeFee]", () => {
  const originDomainID = 1;
  const destinationDomainID = 2;

  const depositAmount = BigInt(100000);
  const feeData = "0x";
  const emptySetResourceData = "0x";
  const feeAmount = BigInt(30);
  const feeBps = 30000; // 3 BPS
  const payout = BigInt(10);

  let BridgeInstance: ContractTypesMap["Bridge"];
  let ERC20MintableInstance: ContractTypesMap["ERC20PresetMinterPauser"];
  let DefaultMessageReceiverInstance: ContractTypesMap["DefaultMessageReceiver"];
  let ERC20HandlerInstance: ContractTypesMap["ERC20Handler"];
  let PercentageFeeHandlerInstance: ContractTypesMap["PercentageERC20FeeHandler"];
  let FeeHandlerRouterInstance: ContractTypesMap["FeeHandlerRouter"];

  let depositor: WalletClient;
  let recipient: WalletClient;
  let firstEOA: WalletClient;
  let secondEOA: WalletClient;

  let resourceID: Hex;
  let depositData: Hex;

  beforeEach(async () => {
    ({
      BridgeInstance,
      ERC20MintableInstance,
      ERC20HandlerInstance,
      PercentageFeeHandlerInstance
    } = await loadFixture(deploySourceChainContracts));
    [
      ,
      depositor,
      recipient,
      firstEOA,
      secondEOA
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
    await ERC20MintableInstance.write.mint([depositor.account!.address, depositAmount + feeAmount]);
    await ERC20MintableInstance.write.approve([
      ERC20HandlerInstance.address,
      depositAmount
    ], {
        account: depositor.account,
      }
    );
    await ERC20MintableInstance.write.approve([
      PercentageFeeHandlerInstance.address,
      depositAmount
    ],
      {
        account: depositor.account
      }
    ),
    await BridgeInstance.write.adminChangeFeeHandler([FeeHandlerRouterInstance.address]);
    await FeeHandlerRouterInstance.write.adminSetResourceHandler([
      destinationDomainID,
      resourceID,
      PercentageFeeHandlerInstance.address
    ]);
    await PercentageFeeHandlerInstance.write.changeFee([destinationDomainID, resourceID, feeBps])

    depositData = createERCDepositData(
      depositAmount,
      20,
      recipient
    );

    // set MPC address to unpause the Bridge
    await BridgeInstance.write.endKeygen([mpcAddress]);
  });

  it("should distribute fees", async () => {
    // check the balance is 0
    const firstBalanceBefore = (
      await ERC20MintableInstance.read.balanceOf([firstEOA.account!.address])
    );
    const secondBalanceBefore = (
      await ERC20MintableInstance.read.balanceOf([secondEOA.account!.address])
    );

    await expect(
      BridgeInstance.write.deposit([
        destinationDomainID,
        resourceID,
        depositData,
        feeData
      ],
        {
          account: depositor.account,
        }
      )
    ).not.to.be.reverted;
    const handlerBalance = await ERC20MintableInstance.read.balanceOf([
      PercentageFeeHandlerInstance.address
    ]);
    assert.equal(handlerBalance, feeAmount);

    // Transfer the funds
    const transferFeeTx = await PercentageFeeHandlerInstance.write.transferERC20Fee([
      resourceID,
      [firstEOA.account!.address, secondEOA.account!.address],
      [payout, payout]
    ]);

    await expect(transferFeeTx).to.emit(PercentageFeeHandlerInstance, "FeeDistributed").withArgs(
      ERC20MintableInstance.address,
      firstEOA.account!.address,
      payout
    );
    await expect(transferFeeTx).to.emit(PercentageFeeHandlerInstance, "FeeDistributed").withArgs(
      ERC20MintableInstance.address,
      secondEOA.account!.address,
      payout
    );

    const firstBalanceAfter = await ERC20MintableInstance.read.balanceOf([firstEOA.account!.address]);
    const secondBalanceAfter = await ERC20MintableInstance.read.balanceOf([secondEOA.account!.address]);
    assert.equal(firstBalanceBefore, firstBalanceAfter + payout);
    assert.equal(secondBalanceBefore, secondBalanceAfter + payout);
  });

  it("should not distribute fees with other resourceID", async () => {
    await expect(
      BridgeInstance.write.deposit([
        destinationDomainID,
        resourceID,
        depositData,
        feeData
      ],
        {
          account: depositor.account,
        }
      )
    ).not.to.be.reverted;
    const balance = await ERC20MintableInstance.read.balanceOf([
      PercentageFeeHandlerInstance.address
    ]);
    assert.equal(balance, feeAmount);

    const incorrectResourceID = createResourceID(
      PercentageFeeHandlerInstance.address,
      originDomainID
    );

    // Transfer the funds: fails
    await expect(
      PercentageFeeHandlerInstance.write.transferERC20Fee([
        incorrectResourceID,
        [firstEOA.account!.address, secondEOA.account!.address],
        [payout, payout]
      ])
    ).to.be.reverted;
  });

  it("should require admin role to distribute fee", async () => {
    await expect(
      BridgeInstance.write.deposit([
        destinationDomainID,
        resourceID,
        depositData,
        feeData
      ],
        {
          account: depositor.account,
        }
      )
    ).not.to.be.reverted;
    const balance = await ERC20MintableInstance.read.balanceOf([
      PercentageFeeHandlerInstance.address
    ]);
    assert.equal(balance, feeAmount);

    await expect(
      PercentageFeeHandlerInstance.write.transferERC20Fee([
      resourceID,
      [firstEOA.account!.address, secondEOA.account!.address],
      [payout, payout]
    ])).to.be.revertedWith("sender doesn't have admin role");
  });

  it("should revert if addrs and amounts arrays have different length", async () => {
    await expect(
      BridgeInstance.write.deposit([
        destinationDomainID,
        resourceID,
        depositData,
        feeData
      ],
        {
          account: depositor.account,
        }
      )
    ).not.to.be.reverted;
    const balance = await ERC20MintableInstance.read.balanceOf([
      PercentageFeeHandlerInstance.address
    ]);
    assert.equal(balance, feeAmount);

    await expect(
      PercentageFeeHandlerInstance.write.transferERC20Fee([
        resourceID,
        [firstEOA.account!.address, secondEOA.account!.address],
        [payout, payout, payout]
      ]),
    ).to.be.revertedWith("addrs[], amounts[]: diff length");
  });
});
