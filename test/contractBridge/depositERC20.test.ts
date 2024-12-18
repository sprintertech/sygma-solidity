import hre from 'hardhat';
// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import {assert, expect} from "chai";
import {createERCDepositData, createResourceID, deploySourceChainContracts, mpcAddress} from "../helpers";
import {ContractTypesMap} from "hardhat/types";
import {Hex, WalletClient} from "viem";
import {loadFixture} from '@nomicfoundation/hardhat-network-helpers';


describe("Bridge - [deposit - ERC20]", async () => {
  const originDomainID = 1;
  const destinationDomainID = 2;

  const originChainInitialTokenAmount = BigInt(100);
  const depositAmount = BigInt(10);
  const expectedDepositNonce = BigInt(1);
  const feeData = "0x";
  const emptySetResourceData = "0x";

  let BridgeInstance: ContractTypesMap["Bridge"];
  let ERC20MintableInstance: ContractTypesMap["ERC20PresetMinterPauser"];
  const ERC20MintableInstanceMock = await hre.viem.deployContract(
    "ERC20PresetMinterPauser",
    ["Token", "TOK"]
  );
  let ERC20HandlerInstance: ContractTypesMap["ERC20Handler"];
  let depositData: Hex;
  let resourceID1: Hex;
  let resourceID2: Hex;

  let depositor: WalletClient;
  let recipient: WalletClient;


  beforeEach(async () => {
    ({
      BridgeInstance,
      ERC20HandlerInstance,
      ERC20MintableInstance,
    } = await loadFixture(deploySourceChainContracts));
    [
      ,
      depositor,
    ] = await hre.viem.getWalletClients();

    const resourceID1 = createResourceID(
      ERC20MintableInstance.address,
      originDomainID
    );
    const resourceID2 = createResourceID(
      ERC20MintableInstanceMock.address,
      originDomainID
    );

    await BridgeInstance.write.adminSetResource([
      ERC20HandlerInstance.address,
      resourceID1,
      ERC20MintableInstance.address,
      emptySetResourceData
    ]);
    await BridgeInstance.write.adminSetResource([
      ERC20HandlerInstance.address,
      resourceID2,
      ERC20MintableInstanceMock.address,
      emptySetResourceData
    ]);
    await ERC20MintableInstance.write.mint([
      depositor.account!.address,
      originChainInitialTokenAmount
    ]);
    await ERC20MintableInstanceMock.write.mint([
      depositor.account!.address,
      originChainInitialTokenAmount
    ]);
    await ERC20MintableInstance.write.approve([
      ERC20HandlerInstance.address,
      depositAmount
    ],
      {
        account: depositor.account
      }
    );
    await ERC20MintableInstanceMock.write.approve([
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

  it("[sanity] test depositor' balance", async () => {
    const originChainDepositorBalance =
      await ERC20MintableInstance.read.balanceOf([depositor.account!.address]);
    assert.strictEqual(
      originChainDepositorBalance,
      originChainInitialTokenAmount
    );
  });

  it("[sanity] test ERC20HandlerInstance.address' allowance", async () => {
    const originChainHandlerAllowance = await ERC20MintableInstance.read.allowance([
        depositor.account!.address,
        ERC20HandlerInstance.address
      ]);
    assert.strictEqual(
      originChainHandlerAllowance,
      depositAmount
    );
  });

  it("ERC20 deposit can be made", async () => {
    await expect(
      BridgeInstance.write.deposit([
        destinationDomainID,
        resourceID1,
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
      resourceID1,
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

  it("ERC20 can be deposited with correct balances", async () => {
    await BridgeInstance.write.deposit([
      destinationDomainID,
      resourceID1,
      depositData,
      feeData],
      {
        account: depositor.account
      }
    );

    const originChainDepositorBalance =
      await ERC20MintableInstance.read.balanceOf([depositor.account!.address]);
    assert.strictEqual(
      originChainDepositorBalance,
      originChainInitialTokenAmount - depositAmount
    );

    const originChainHandlerBalance =
      await ERC20MintableInstance.read.balanceOf([
        ERC20HandlerInstance.address
      ]);
    assert.strictEqual(originChainHandlerBalance, depositAmount);
  });

  it("Deposit event is fired with expected value", async () => {
    let depositTx = await BridgeInstance.write.deposit([
      destinationDomainID,
      resourceID1,
      depositData,
      feeData
    ],
      {
        account: depositor.account
      }
    );

    await expect(depositTx).to.emit(BridgeInstance, "Deposit").withArgs(
      destinationDomainID,
      resourceID1.toLowerCase(),
      expectedDepositNonce
    );
  });

  it("deposit requires resourceID that is mapped to a handler", async () => {
    await expect(
      BridgeInstance.write.deposit([
        destinationDomainID,
        "0x0",
        depositData,
        feeData
      ],
        {
          account: depositor.account,
        }
      ),
    ).to.be.revertedWithCustomError(BridgeInstance, "ResourceIDNotMappedToHandler()");
  });

  it("Deposit destination domain can not be current bridge domain ", async () => {
    await expect(
      BridgeInstance.write.deposit([
        originDomainID,
        "0x0",
        depositData,
        feeData
      ],
        {
          account: depositor.account,
        }
      ),
    ).to.be.revertedWithCustomError(BridgeInstance, "DepositToCurrentDomain()");
  });

  it("should revert if ERC20Safe contract call fails", async () => {
    await expect(
      BridgeInstance.write.deposit([
        destinationDomainID,
        resourceID2,
        depositData,
        feeData
      ],
        {
          account: depositor.account
        }
      ),
    ).to.be.revertedWith("ERC20: operation did not succeed")
  });
});
