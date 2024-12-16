// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {Hex, parseEther, WalletClient} from "viem";
import {createERCDepositData, createResourceID, deploySourceChainContracts, mpcAddress} from "../../../helpers";
import {ContractTypesMap} from "hardhat/types";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {assert, expect} from 'chai';


describe("PercentageFeeHandler - [collectFee]", () => {
  const originDomainID = 1;
  const destinationDomainID = 2;
  const tokenAmount = parseEther("200000");

  const emptySetResourceData = "0x";
  const feeData = "0x";
  const feeBps = 60000; // BPS
  const fee = parseEther("120");
  const lowerBound = parseEther("100");
  const upperBound = parseEther("300");


  let BridgeInstance: ContractTypesMap["Bridge"];
  let PercentageFeeHandlerInstance: ContractTypesMap["PercentageERC20FeeHandler"];
  let FeeHandlerRouterInstance: ContractTypesMap["FeeHandlerRouter"];
  let ERC20HandlerInstance: ContractTypesMap["ERC20Handler"];
  let ERC20MintableInstance: ContractTypesMap["ERC20PresetMinterPauser"];

  let depositor: WalletClient;
  let recipient: WalletClient;

  let depositData: Hex;
  let resourceID: Hex;


  before(async () => {
    ({
      BridgeInstance,
      ERC20MintableInstance,
      ERC20HandlerInstance,
      PercentageFeeHandlerInstance
    } = await loadFixture(deploySourceChainContracts));
    [
      ,
      depositor,
      recipient
    ] = await hre.viem.getWalletClients();

    resourceID = createResourceID(
      ERC20MintableInstance.address,
      originDomainID
    );

    await PercentageFeeHandlerInstance.write.changeFee([destinationDomainID, resourceID, feeBps]);
    await PercentageFeeHandlerInstance.write.changeFeeBounds([resourceID, lowerBound, upperBound]);

    await BridgeInstance.write.adminSetResource([
      ERC20HandlerInstance.address,
      resourceID,
      ERC20MintableInstance.address,
      emptySetResourceData
    ]);
    await ERC20MintableInstance.write.mint([depositor.account!.address, tokenAmount + fee]),
    await ERC20MintableInstance.write.approve([ERC20HandlerInstance.address, tokenAmount], {
      account: depositor.account,
    });
    await ERC20MintableInstance.write.approve([PercentageFeeHandlerInstance.address, fee], {
      account: depositor.account,
    });
    await BridgeInstance.write.adminChangeFeeHandler([FeeHandlerRouterInstance.address]);
    await FeeHandlerRouterInstance.write.adminSetResourceHandler([
      destinationDomainID,
      resourceID,
      PercentageFeeHandlerInstance.address
    ]);

    depositData = createERCDepositData(
      tokenAmount,
      20,
      recipient.account!.address
    );

    // set MPC address to unpause the Bridge
    await BridgeInstance.write.endKeygen([mpcAddress]);
  });

  it("should collect fee in tokens", async () => {
    const balanceBefore =
      await ERC20MintableInstance.read.balanceOf([
        PercentageFeeHandlerInstance.address
    ]);

    const depositTx = await BridgeInstance.write.deposit([
      destinationDomainID,
      resourceID,
      depositData,
      feeData
      ],
        {
          account: depositor.account,
        }
      );

    await expect(depositTx).to.emit(BridgeInstance, "Deposit").withArgs(
      destinationDomainID,
      resourceID.toLowerCase()
    );

    await expect(depositTx).to.emit(PercentageFeeHandlerInstance, "FeeCollected").withArgs(
      depositor,
      originDomainID,
      destinationDomainID,
      resourceID.toLowerCase(),
      fee.toString(),
      ERC20MintableInstance.address
    );

    const balanceAfter =
      await ERC20MintableInstance.read.balanceOf([
        PercentageFeeHandlerInstance.address
      ]);

    assert.equal(balanceAfter, balanceBefore + fee);
  });

  it("deposit should revert if msg.value != 0", async () => {
    await expect(
      BridgeInstance.write.deposit([
        destinationDomainID,
        resourceID,
        depositData,
        feeData
        ],
          {
            account: depositor.account,
            value: parseEther("0.5"),
          }
        ),
      ).to.be.revertedWith("collectFee: msg.value != 0")
  });

  it("deposit should revert if fee collection fails", async () => {
    const depositData = createERCDepositData(
      tokenAmount,
      20,
      recipient.account!.address
    );

    await ERC20MintableInstance.write.approve([
      PercentageFeeHandlerInstance.address,
      0
    ],
      {
        account: depositor.account
      }
    );
    await expect(
      BridgeInstance.write.deposit([
        destinationDomainID,
        resourceID,
        depositData,
        feeData],
        {
          account: depositor.account,
          value: parseEther("0.5"),
        }
      )
    ).to.be.reverted;
  });

  it("deposit should revert if not called by router on PercentageFeeHandler contract", async () => {
    const depositData = createERCDepositData(
      tokenAmount,
      20,
      recipient.account!.address
    );
    await ERC20MintableInstance.write.approve([
      PercentageFeeHandlerInstance.address,
      BigInt(0)
    ],
      {
        account: depositor.account
      }
    );
    await expect(
      PercentageFeeHandlerInstance.write.collectFee([
        depositor.account!.address,
        originDomainID,
        destinationDomainID,
        resourceID,
        depositData,
        feeData
        ],
          {
            account: depositor.account,
            value: parseEther("0.5"),
          }
        ),
      ).to.be.revertedWith("sender must be bridge or fee router contract");
  });

  it("deposit should revert if not called by bridge on FeeHandlerRouter contract", async () => {
    const depositData = createERCDepositData(
      tokenAmount,
      20,
      recipient.account!.address
    );
    await ERC20MintableInstance.write.approve([
      PercentageFeeHandlerInstance.address,
      BigInt(0)
    ],
      {
        account: depositor.account
      }
    );
    await expect(
      FeeHandlerRouterInstance.write.collectFee([
        depositor.account!.address,
        originDomainID,
        destinationDomainID,
        resourceID,
        depositData,
        feeData
      ],
        {
          account: depositor.account,
          value: parseEther("0.5"),
        }
      ),
    ).to.be.revertedWith("sender must be bridge contract");
  });

  it("should successfully change fee handler from FeeRouter to PercentageFeeHandler and collect fee", async () => {
    await BridgeInstance.write.adminChangeFeeHandler([
      PercentageFeeHandlerInstance.address
    ]);

    const balanceBefore =
      await ERC20MintableInstance.read.balanceOf([
        PercentageFeeHandlerInstance.address
      ]);

    const depositTx = await BridgeInstance.write.deposit([
      destinationDomainID,
      resourceID,
      depositData,
      feeData
    ],
      {
        account: depositor.account,
      }
    );

    await expect(depositTx).to.emit(BridgeInstance, "Deposit").withArgs(
      destinationDomainID,
      resourceID.toLowerCase()
    );

    await expect(depositTx).to.emit(PercentageFeeHandlerInstance, "FeeCollected").withArgs(
      depositor,
      originDomainID,
      destinationDomainID,
      resourceID.toLowerCase(),
      fee.toString(),
      ERC20MintableInstance.address
    );

    const balanceAfter =
      await ERC20MintableInstance.read.balanceOf([
        PercentageFeeHandlerInstance.address
      ]);
    assert.equal(balanceAfter, balanceBefore + fee);
  });
});
