// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {ContractTypesMap} from "hardhat/types";
import {createERC1155DepositData, createResourceID, deploySourceChainContracts, mpcAddress} from "../helpers";
import {Hex, WalletClient} from "viem";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {assert, expect} from "chai";

describe("Bridge - [deposit - ERC1155]", () => {
  const originDomainID = 1;
  const destinationDomainID = 2;

  const tokenID = BigInt(42);
  const initialTokenAmount = BigInt(100);
  const depositAmount = BigInt(10);
  const expectedDepositNonce = BigInt(1);
  const feeData = "0x";
  const emptySetResourceData = "0x";

  let BridgeInstance: ContractTypesMap["Bridge"];
  let ERC1155MintableInstance: ContractTypesMap["ERC1155PresetMinterPauser"];
  let ERC1155HandlerInstance: ContractTypesMap["ERC1155Handler"];

  let depositor: WalletClient;

  let depositData: Hex;
  let resourceID: Hex;

  beforeEach(async () => {
    ({
      BridgeInstance,
      ERC1155HandlerInstance,
      ERC1155MintableInstance,
    } = await loadFixture(deploySourceChainContracts));
    [
      ,
      depositor,
    ] = await hre.viem.getWalletClients();

    resourceID = createResourceID(
      ERC1155MintableInstance.address,
      originDomainID
    );

    await BridgeInstance.write.adminSetResource([
      ERC1155HandlerInstance.address,
      resourceID,
      ERC1155MintableInstance.address,
      emptySetResourceData
    ]);
    await ERC1155MintableInstance.write.mintBatch([
      depositor.account!.address,
      [tokenID],
      [initialTokenAmount],
      "0x00"
    ]);
    await ERC1155MintableInstance.write.setApprovalForAll([
      ERC1155HandlerInstance.address,
      true
    ],
      {
        account: depositor.account
      }
    );

    depositData = createERC1155DepositData(
      [tokenID],
      [depositAmount]
    );

    // set MPC address to unpause the Bridge
    await BridgeInstance.write.endKeygen([mpcAddress]);
  });

  it("[sanity] test depositor' balance", async () => {
    const originChainDepositorBalance =
      await ERC1155MintableInstance.read.balanceOf([
        depositor.account!.address,
        tokenID
      ]);

    assert.strictEqual(
      originChainDepositorBalance,
      initialTokenAmount
    );
  });

  it("[sanity] test ERC1155HandlerInstance.address' allowance", async () => {
    const originChainHandlerApprovedStatus =
      await ERC1155MintableInstance.read.isApprovedForAll([
        depositor.account!.address,
        ERC1155HandlerInstance.address
      ]);

    assert.strictEqual(originChainHandlerApprovedStatus, true);
  });

  it("ERC1155 deposit can be made", async () => {
    await expect(
      BridgeInstance.write.deposit([
        destinationDomainID,
        resourceID,
        depositData,
        feeData
      ],
        {
          account: depositor.account
        }
      )
    ).not.to.be.reverted;
  });

  it("_depositCounts should be increments from 0 to 1", async () => {
    await BridgeInstance.write.deposit([
      destinationDomainID,
      resourceID,
      depositData,
      feeData
    ],
      {
        account: depositor.account
      }
    );

    const depositCount = await BridgeInstance.read._depositCounts([
      destinationDomainID
    ]);
    assert.strictEqual(depositCount, expectedDepositNonce);
  });

  it("ERC1155 can be deposited with correct balances", async () => {
    await BridgeInstance.write.deposit([
      destinationDomainID,
      resourceID,
      depositData,
      feeData
    ],
      {
        account: depositor.account
      }
    );

    const originChainDepositorBalance =
      await ERC1155MintableInstance.read.balanceOf([
        depositor.account!.address,
        tokenID
      ]);

    assert.strictEqual(
      originChainDepositorBalance,
      initialTokenAmount - depositAmount
    );

    const originChainHandlerBalance =
      await ERC1155MintableInstance.read.balanceOf([
        ERC1155HandlerInstance.address,
        tokenID
      ]);
    assert.strictEqual(originChainHandlerBalance, depositAmount);
  });

  it("Deposit event is fired with expected value", async () => {
    let depositTx = await BridgeInstance.write.deposit([
      destinationDomainID,
      resourceID,
      depositData,
      feeData
    ],
      {
        account: depositor.account
      }
    );

    await expect(depositTx).to.emit(BridgeInstance, "Deposit").withArgs(
      destinationDomainID,
      resourceID.toLowerCase(),
      expectedDepositNonce
    );
  });

  it("deposit requires resourceID that is mapped to a handler", async () => {
    await expect(
      BridgeInstance.write.deposit([
        destinationDomainID,
        "0x00",
        depositData,
        feeData
      ],
        {
          account: depositor.account,
        }
      )
    ).to.be.revertedWithCustomError(BridgeInstance,"ResourceIDNotMappedToHandler()");
  });

  it("Deposit destination domain can not be current bridge domain ", async () => {
    await expect(
      BridgeInstance.write.deposit([
        originDomainID,
        "0x00",
        depositData,
        feeData
      ],
        {
          account: depositor.account,
        }
      )
    ).to.be.revertedWithCustomError(BridgeInstance, "DepositToCurrentDomain()");
  });
});
