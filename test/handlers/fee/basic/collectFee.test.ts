// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {Hex, parseEther, WalletClient, zeroAddress} from "viem";
import {createResourceID, deploySourceChainContracts, mpcAddress} from "../../../helpers";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";

const Helpers = require("../../../helpers");

import {ContractTypesMap} from "hardhat/types";
import {assert, expect} from 'chai';

describe("BasicFeeHandler - [collectFee]", () => {
  const originDomainID = 1;
  const destinationDomainID = 2;

  const depositAmount = BigInt(10);
  const feeData = "0x";
  const tokenID = BigInt(1);
  const emptySetResourceData = "0x";

  let BridgeInstance: ContractTypesMap["Bridge"];
  let ERC20MintableInstance: ContractTypesMap["ERC20PresetMinterPauser"];
  let ERC20HandlerInstance: ContractTypesMap["ERC20Handler"];
  let ERC721HandlerInstance: ContractTypesMap["ERC721Handler"];
  let ERC721MintableInstance: ContractTypesMap["ERC721MinterBurnerPauser"];
  let ERC20BasicFeeHandlerInstance: ContractTypesMap["BasicFeeHandler"];
  let ERC721BasicFeeHandlerInstance: ContractTypesMap["BasicFeeHandler"];
  let FeeHandlerRouterInstance: ContractTypesMap["FeeHandlerRouter"];

  let depositor: WalletClient;
  let recipient: WalletClient;

  let erc20ResourceID: Hex;
  let erc721ResourceID: Hex;
  let erc20depositData: Hex;
  let erc721depositData: Hex;

  before(async () => {
    ({
      BridgeInstance,
      ERC20MintableInstance,
      ERC20HandlerInstance,
      ERC721MintableInstance,
      ERC721HandlerInstance,
      BasicFeeHandlerInstance: ERC20BasicFeeHandlerInstance,
      BasicFeeHandlerInstance: ERC721BasicFeeHandlerInstance,
    } = await loadFixture(deploySourceChainContracts));
    [
      ,
      depositor,
      recipient
    ] = await hre.viem.getWalletClients();

    erc20ResourceID = createResourceID(
      ERC20MintableInstance.address,
      originDomainID
    );
    erc721ResourceID = createResourceID(
      ERC721MintableInstance.address,
      originDomainID
    );

    await BridgeInstance.write.adminSetResource([
      ERC20HandlerInstance.address,
      erc20ResourceID,
      ERC20MintableInstance.address,
      emptySetResourceData
    ]);
    await BridgeInstance.write.adminSetResource([
      ERC721HandlerInstance.address,
      erc721ResourceID,
      ERC721MintableInstance.address,
      emptySetResourceData
    ]);
    await ERC20MintableInstance.write.mint([depositor.account!.address, depositAmount]);
    await ERC20MintableInstance.write.approve([
      ERC20HandlerInstance.address,
      depositAmount
    ],
      {
        account: depositor.account
      }
    ),
    await ERC721MintableInstance.write.mint([depositor.account!.address, tokenID, ""]);
    await ERC721MintableInstance.write.approve([ERC721HandlerInstance.address, tokenID
    ],
      {
        account: depositor.account,
      }
    );
    await BridgeInstance.write.adminChangeFeeHandler([FeeHandlerRouterInstance.address]);
    await FeeHandlerRouterInstance.write.adminSetResourceHandler([
      destinationDomainID,
      erc20ResourceID,
      ERC20BasicFeeHandlerInstance.address
    ]);
    await FeeHandlerRouterInstance.write.adminSetResourceHandler([
      destinationDomainID,
      erc721ResourceID,
      ERC721BasicFeeHandlerInstance.address
    ]);

    erc20depositData = createERCDepositData(
      depositAmount,
      20,
      recipient
    );
    erc721depositData = createERCDepositData(
      tokenID,
      20,
      recipient
    );

    // set MPC address to unpause the Bridge
    await BridgeInstance.write.endKeygen([mpcAddress]);
  });

  it("[sanity] Generic deposit can be made", async () => {
    await expect(
      BridgeInstance.write.deposit([
        destinationDomainID,
        erc20ResourceID,
        erc20depositData,
        feeData
      ],
        {
          account: depositor.account
        }
      )
    ).not.to.be.reverted;
  });

  it("deposit should revert if invalid fee amount supplied", async () => {
    // current fee is set to 0
    assert.equal(await ERC20BasicFeeHandlerInstance.read._domainResourceIDToFee([destinationDomainID, erc20ResourceID]), BigInt(0));
    const incorrectFee = parseEther("1.0");

    await expect(BridgeInstance.write.deposit([
        destinationDomainID,
        erc20ResourceID,
        erc20depositData,
        feeData
      ],
        {
           account: depositor.account,
          value: incorrectFee,
        }
      )
    ).to.be.revertedWithCustomError(ERC20BasicFeeHandlerInstance, "IncorrectFeeSupplied(uint256)").withArgs(
      incorrectFee
    );
  });

  it("deposit should pass if valid fee amount supplied for ERC20 deposit", async () => {
    const fee = parseEther("0.5");
    // current fee is set to 0
    assert.equal(await ERC20BasicFeeHandlerInstance.read._domainResourceIDToFee([destinationDomainID, erc20ResourceID]), BigInt(0));
    // Change fee to 0.5 ether
    await ERC20BasicFeeHandlerInstance.write.changeFee([destinationDomainID, erc20ResourceID, fee]);
    assert.equal(
      await ERC20BasicFeeHandlerInstance.read._domainResourceIDToFee([destinationDomainID, erc20ResourceID]),
      parseEther("0.5")
    );

    const balanceBefore = await getBalance(
      ERC20BasicFeeHandlerInstance.address
    );

    const depositTx = await BridgeInstance.write.deposit([
      destinationDomainID,
      erc20ResourceID,
      erc20depositData,
      feeData
    ],
      {
        account: depositor.account,
        value: fee,
      }
    );

    await expect(depositTx).to.emit(BridgeInstance, "Deposit").withArgs(
      destinationDomainID,
      erc20ResourceID.toLowerCase()
    );

    await expect(depositTx).to.emit(ERC20BasicFeeHandlerInstance, "FeeCollected").withArgs(
      depositor,
      originDomainID,
      destinationDomainID,
      erc20ResourceID.toLowerCase(),
      fee.toString(),
      zeroAddress,
    );

    const balanceAfter = await getBalance(
      ERC20BasicFeeHandlerInstance.address
    );
    assert.equal(balanceAfter, balanceBefore + fee);
  });

  it("deposit should pass if valid fee amount supplied for ERC721 deposit", async () => {
    const fee = parseEther("0.4");
    // current fee is set to 0
    assert.equal(await ERC721BasicFeeHandlerInstance.read._domainResourceIDToFee([destinationDomainID, erc721ResourceID]), BigInt(0));
    // Change fee to 0.4 ether
    await ERC721BasicFeeHandlerInstance.write.changeFee([destinationDomainID, erc721ResourceID, fee]);
    assert.equal(
      await ERC721BasicFeeHandlerInstance.read._domainResourceIDToFee([destinationDomainID, erc721ResourceID]),
      parseEther("0.4")
    );

    const balanceBefore = await getBalance(
      ERC721BasicFeeHandlerInstance.address
    );

    const depositTx = await BridgeInstance.write.deposit([
      destinationDomainID,
      erc721ResourceID,
      erc721depositData,
      feeData
    ],
      {
        account: depositor.account,
        value: fee,
      }
    );

    await expect(depositTx).to.emit(BridgeInstance, "Deposit").withArgs(
      destinationDomainID,
      erc721ResourceID.toLowerCase(),
    );

    await expect(depositTx).to.emit(ERC721BasicFeeHandlerInstance, "FeeCollected").withArgs(
      depositor,
      originDomainID,
      destinationDomainID,
      erc721ResourceID.toLowerCase(),
      fee.toString(),
      zeroAddress,
    );

    const balanceAfter = await getBalance(
      ERC721BasicFeeHandlerInstance.address
    );
    assert.equal(balanceAfter, fee.add(balanceBefore));
  });

  it("deposit should revert if fee handler not set and fee supplied", async () => {
    await BridgeInstance.write.adminChangeFeeHandler([
      zeroAddress
    ]);

    await expect(
      BridgeInstance.write.deposit([
        destinationDomainID,
        erc20ResourceID,
        erc20depositData,
        feeData
      ],
        {
          account: depositor.account,
          value: parseEther("1.0"),
        }
      )
    ).to.be.revertedWith("no FeeHandler, msg.value != 0");
  });

  it("deposit should pass if fee handler not set and fee not supplied", async () => {
    await expect(
      BridgeInstance.write.deposit([
        destinationDomainID,
        erc20ResourceID,
        erc20depositData,
        feeData
      ],
        {
          account: depositor.account
        }
      )
    ).not.to.be.reverted;
  });

  it("deposit should revert if not called by router on BasicFeeHandler contract", async () => {
    const fee = parseEther("0.5");
    await BridgeInstance.write.adminChangeFeeHandler([
      ERC20BasicFeeHandlerInstance.address
    ]);
    // current fee is set to 0
    assert.equal(await ERC20BasicFeeHandlerInstance.read._domainResourceIDToFee([destinationDomainID, erc20ResourceID]), BigInt(0));
    // Change fee to 0.5 ether
    await ERC20BasicFeeHandlerInstance.write.changeFee([destinationDomainID, erc20ResourceID, fee]);
    assert.equal(
      await ERC20BasicFeeHandlerInstance.read._domainResourceIDToFee([destinationDomainID, erc20ResourceID]),
      parseEther("0.5")
    );

    const balanceBefore = await getBalance(
      ERC20BasicFeeHandlerInstance.address
    );

    await expect(
      ERC20BasicFeeHandlerInstance.write.collectFee([
        depositor.account!.address,
        originDomainID,
        destinationDomainID,
        erc20ResourceID,
        erc20depositData,
        feeData
      ],
        {
          account: depositor.account,
          value: parseEther("0.5"),
        }
      )
    ).to.be.revertedWith("sender must be bridge or fee router contract");

    const balanceAfter = await getBalance(
      ERC20BasicFeeHandlerInstance.address
    );
    assert.equal(balanceAfter, balanceBefore);
  });

  it("deposit should revert if not called by bridge on FeeHandlerRouter contract", async () => {
    const fee = parseEther("0.5");
    await BridgeInstance.write.adminChangeFeeHandler([
      ERC20BasicFeeHandlerInstance.address
    ]);
    // current fee is set to 0
    assert.equal(await ERC20BasicFeeHandlerInstance.read._domainResourceIDToFee([destinationDomainID, erc20ResourceID]), BigInt(0));
    // Change fee to 0.5 ether
    await ERC20BasicFeeHandlerInstance.write.changeFee([destinationDomainID, erc20ResourceID, fee]);
    assert.equal(
        await ERC20BasicFeeHandlerInstance.read._domainResourceIDToFee([destinationDomainID, erc20ResourceID]),
      parseEther("0.5")
    );

    const balanceBefore = await getBalance(
      ERC20BasicFeeHandlerInstance.address
    );

    await expect(
      FeeHandlerRouterInstance.write.collectFee([
        depositor,
        originDomainID,
        destinationDomainID,
        erc20ResourceID,
        erc20depositData,
        feeData
      ],
        {
          account: depositor.account,
          value: parseEther("0.5"),
        }
      )
    ).to.be.revertedWith("sender must be bridge contract");

    const balanceAfter = await getBalance(
      ERC20BasicFeeHandlerInstance.address
    );
    assert.equal(balanceAfter, balanceBefore);
  });

  it(
    "should successfully change fee handler from FeeRouter to ERC20BasicFeeHandlerInstance and collect fee",
    async () => {
    await BridgeInstance.write.adminChangeFeeHandler([
      ERC20BasicFeeHandlerInstance.address
    ]);

    const fee = parseEther("0.5");
    // current fee is set to 0
    assert.equal(await ERC20BasicFeeHandlerInstance.read._domainResourceIDToFee([destinationDomainID, erc20ResourceID]), BigInt(0));
    // Change fee to 0.5 ether
    await ERC20BasicFeeHandlerInstance.write.changeFee([destinationDomainID, erc20ResourceID, fee]);
    assert.equal(
      await ERC20BasicFeeHandlerInstance.read._domainResourceIDToFee([destinationDomainID, erc20ResourceID]),
      parseEther("0.5")
    );

    const balanceBefore = await getBalance(
      ERC20BasicFeeHandlerInstance.address
    );

    const depositTx = await BridgeInstance.write.deposit([
      destinationDomainID,
      erc20ResourceID,
      erc20depositData,
      feeData
    ],
      {
        account: depositor.account,
        value: fee,
      }
    );

    await expect(depositTx).to.emit(BridgeInstance, "Deposit").withArgs(
      destinationDomainID,
      erc20ResourceID.toLowerCase
    );

    await expect(depositTx).to.emit(ERC20BasicFeeHandlerInstance, "FeeCollected").withArgs(
      depositor,
      originDomainID,
      destinationDomainID,
      erc20ResourceID.toLowerCase(),
      fee.toString(),
      zeroAddress
    );

    const balanceAfter = await getBalance(
      ERC20BasicFeeHandlerInstance.address
    );
    assert.equal(balanceAfter, balanceBefore + fee);
  });

  it(
    "should successfully change fee handler from FeeRouter to ERC721BasicFeeHandlerInstance and collect fee",
    async () => {
    await BridgeInstance.write.adminChangeFeeHandler([
      ERC721BasicFeeHandlerInstance.address
    ]);

    const fee = parseEther("0.4");
    // current fee is set to 0
    assert.equal(await ERC721BasicFeeHandlerInstance.read._domainResourceIDToFee([destinationDomainID, erc721ResourceID]), BigInt(0));
    // Change fee to 0.4 ether
    await ERC721BasicFeeHandlerInstance.write.changeFee([destinationDomainID, erc721ResourceID, fee]);
    assert.equal(
      await ERC721BasicFeeHandlerInstance.read._domainResourceIDToFee([destinationDomainID, erc721ResourceID]),
      parseEther("0.4")
    );

    const balanceBefore = await getBalance(
      ERC721BasicFeeHandlerInstance.address
    );

    const depositTx = await BridgeInstance.write.deposit([
      destinationDomainID,
      erc721ResourceID,
      erc721depositData,
      feeData
    ],
      {
        account: depositor.account,
        value: fee,
      }
    );

    await expect(depositTx).to.emit(BridgeInstance, "Deposit").withArgs(
      destinationDomainID,
      erc721ResourceID.toLowerCase()
    );
    await expect(depositTx).to.emit(ERC721BasicFeeHandlerInstance, "FeeCollected").withArgs(
      depositor,
      originDomainID,
      destinationDomainID,
      erc721ResourceID.toLowerCase(),
      fee.toString(),
      zeroAddress,
    );

    const balanceAfter = await getBalance(
      ERC721BasicFeeHandlerInstance.address
    );
    assert.equal(balanceAfter, balanceBefore + fee);
  });
});
