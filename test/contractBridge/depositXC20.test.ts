// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {ContractTypesMap} from "hardhat/types";
import {createERCDepositData, createResourceID, deploySourceChainContracts, mpcAddress} from "../helpers";
import {loadFixture} from '@nomicfoundation/hardhat-network-helpers';
import {assert, expect} from 'chai';
import {Hex, WalletClient} from 'viem';


describe("Bridge - [deposit - XRC20]", async () => {
  const originDomainID = 1;
  const destinationDomainID = 2;

  const initialTokenAmount = BigInt(100);
  const depositAmount = BigInt(10);
  const expectedDepositNonce = BigInt(1);
  const feeData = "0x";
  const emptySetResourceData = "0x";

  let BridgeInstance: ContractTypesMap["Bridge"];
  let XC20TestInstance: ContractTypesMap["XC20Test"];
  const XC20TestInstanceMock = await hre.viem.deployContract("XC20TestMock");
  let XC20HandlerInstance: ContractTypesMap["XC20Handler"];

  let depositor: WalletClient;
  let recipient: WalletClient;

  let depositData: Hex;
  let resourceID1: Hex;
  let resourceID2: Hex

  before(async () => {
    ({
      XC20TestInstance,
      BridgeInstance,
      XC20HandlerInstance,
    } = await loadFixture(deploySourceChainContracts));
    [
      ,
      depositor,
      recipient,
    ] = await hre.viem.getWalletClients();

    resourceID1 = createResourceID(
      XC20TestInstance.address,
      originDomainID
    );
    resourceID2 = createResourceID(
      XC20TestInstanceMock.address,
      originDomainID
    );

    await BridgeInstance.write.adminSetResource([
      XC20HandlerInstance.address,
      resourceID1,
      XC20TestInstance.address,
      emptySetResourceData
    ]);
    await BridgeInstance.write.adminSetResource([
      XC20HandlerInstance.address,
      resourceID2,
      XC20TestInstanceMock.address,
      emptySetResourceData
    ]);
    await XC20TestInstance.write.mint([
      depositor.account!.address,
      initialTokenAmount
    ]),
    await XC20TestInstanceMock.write.mint([
        depositor.account!.address,
        initialTokenAmount
    ]);
    await XC20TestInstance.write.approve([
      XC20HandlerInstance.address,
      depositAmount
    ],
      {
        account: depositor.account
      }
    );
    await XC20TestInstanceMock.write.approve([
      XC20HandlerInstance.address,
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

  describe("lock/release strategy", async () => {
    it("[sanity] test depositor' balance", async () => {
      const originChainDepositorBalance =
        await XC20TestInstance.read.balanceOf([depositor.account!.address]);
      assert.strictEqual(
        originChainDepositorBalance,
        initialTokenAmount
      );
    });

    it("XC20 deposit can be made", async () => {
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

    it("XC20 can be deposited with correct balances", async () => {
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

      const originChainDepositorBalance =
        await XC20TestInstance.read.balanceOf([depositor.account!.address]);

      assert.strictEqual(
        originChainDepositorBalance,
        initialTokenAmount - depositAmount
      );

      const originChainHandlerBalance = await XC20TestInstance.read.balanceOf([
        XC20HandlerInstance.address
      ]);
      assert.strictEqual(originChainHandlerBalance, depositAmount);
    });

    it("Deposit event is fired with expected value", async () => {
      // set allowance to 2 * depositAmount since 2 deposits are made in this test
      await XC20TestInstance.write.approve([
        XC20HandlerInstance.address,
        depositAmount * BigInt(2)
      ],
        {
          account: depositor.account
        }
      );

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

      depositTx = await BridgeInstance.write.deposit([
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
        expectedDepositNonce + BigInt(1)
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
            account: depositor.account
          }
        )
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
        )
      ).to.be.revertedWithCustomError(BridgeInstance, "DepositToCurrentDomain()");
    });

    it("should if XC20Safe contract call fails", async () => {
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
        )
      ).to.be.revertedWith("ERC20: operation did not succeed");
    });
  });

  describe("mint/burn strategy", async () => {
    before(async () => {
      await BridgeInstance.write.adminSetBurnable([
        XC20HandlerInstance.address,
        XC20TestInstance.address
      ]);
    });

    it("[sanity] test depositor' balance", async () => {
      const originChainDepositorBalance =
        await XC20TestInstance.read.balanceOf([depositor.account!.address]);
      assert.strictEqual(
        originChainDepositorBalance,
        initialTokenAmount
      );
    });

    it("XC20 deposit can be made", async () => {
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

    it("XC20 can be deposited with correct balances", async () => {
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

      const originChainDepositorBalance =
        await XC20TestInstance.read.balanceOf([depositor.account!.address]);
      assert.strictEqual(
        originChainDepositorBalance,
        initialTokenAmount - depositAmount
      );

      const originChainHandlerAllowance = await XC20TestInstance.read.allowance([
        depositor.account!.address,
        XC20HandlerInstance.address
      ]);
      assert.strictEqual(originChainHandlerAllowance, depositAmount);
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

      depositTx = await BridgeInstance.write.deposit([
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
        expectedDepositNonce + BigInt(1)
      );
    });

    it("deposit requires resourceID1 that is mapped to a handler", async () => {
      await expect(
        BridgeInstance.write.deposit([
          destinationDomainID,
          "0x0",
          depositData,
          feeData
        ],
          {
            account: depositor.account
          }
        )
      ).to.be.revertedWithCustomError(BridgeInstance, "ResourceIDNotMappedToHandler()");
    });

    it("Deposit destination domain can not be current bridge domain ", async () => {
      await expect(
        BridgeInstance.write.deposit([originDomainID, "0x0", depositData, feeData],
          {
            account: depositor.account,
          }
        )
      ).to.be.revertedWithCustomError(BridgeInstance, "DepositToCurrentDomain()");
    });
  });
});
