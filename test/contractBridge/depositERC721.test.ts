// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {Hex, toHex} from "viem";
import {createERCDepositData, createResourceID, deploySourceChainContracts, mpcAddress} from "../helpers";
import {ContractTypesMap} from "hardhat/types";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {assert, expect} from 'chai';


describe("Bridge - [deposit - ERC721]", () => {
  const originDomainID = 1;
  const destinationDomainID = 2;

  const tokenID = BigInt(42);
  const expectedDepositNonce = BigInt(1);
  const genericBytes = "0x736f796c656e745f677265656e5f69735f70656f706c65";
  const feeData = "0x";
  const emptySetResourceData = "0x";

  let BridgeInstance: ContractTypesMap["Bridge"];
  let DefaultMessageReceiverInstance: ContractTypesMap["DefaultMessageReceiver"];
  let ERC721MintableInstance: ContractTypesMap["ERC721MinterBurnerPauser"];
  let ERC721HandlerInstance: ContractTypesMap["ERC721Handler"];

  let depositor: WalletClient;
  let recipient: WalletCleint;

  let depositData: Hex;
  let resourceID: Hex;

  beforeEach(async () => {
    ({
      DefaultMessageReceiverInstance,
      BridgeInstance,
      ERC721HandlerInstance,
      ERC721MintableInstance,
    } = await loadFixture(deploySourceChainContracts));
    [
      ,
      depositor,
      recipient,
    ] = await hre.viem.getWalletClients();

    resourceID = createResourceID(
      ERC721MintableInstance.address,
      originDomainID
    );

    await BridgeInstance.write.adminSetResource([
      ERC721HandlerInstance.address,
      resourceID,
      ERC721MintableInstance.address,
      emptySetResourceData
    ]);
    await ERC721MintableInstance.write.mint([
      depositor,
      tokenID,
      genericBytes
    ]);

    await ERC721MintableInstance.write.approve([
      ERC721HandlerInstance.address,
      tokenID
    ],
      {
        account: depositor.account
      }
    );

    depositData = createERCDepositData(
      tokenID,
      20,
      recipient
    );

    // set MPC address to unpause the Bridge
    await BridgeInstance.write.endKeygen([mpcAddress]);
  });

  it("[sanity] test depositor' balance", async () => {
    const depositorBalance =
      await ERC721MintableInstance.read.balanceOf([depositor]);
    assert.strictEqual(depositorBalance, BigInt(1));
  });

  it(`[sanity] test depositor owns token with ID: ${tokenID}`, async () => {
    const tokenOwner = await ERC721MintableInstance.read.ownerOf([
      tokenID
    ]);
    assert.strictEqual(tokenOwner, depositor);
  });

  it("[sanity] test ERC721HandlerInstance.address' allowance", async () => {
    const allowanceHolder = await ERC721MintableInstance.read.getApproved([
      tokenID
    ]);
    assert.strictEqual(allowanceHolder, ERC721HandlerInstance.address);
  });

  it("ERC721 deposit can be made", async () => {
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

  it("ERC721 can be deposited with correct owner and balances", async () => {
    await BridgeInstance.write.deposit([
      destinationDomainID,
      resourceID,
      depositData,
      feeData
    ],
      {account: depositor.account}
    );

    const tokenOwner = await ERC721MintableInstance.read.ownerOf([
      tokenID
    ]);
    assert.strictEqual(tokenOwner, ERC721HandlerInstance.address);

    const depositorBalance =
      await ERC721MintableInstance.read.balanceOf([depositor]);
    assert.strictEqual(depositorBalance, BigInt(0));

    const originChainHandlerBalance =
      await ERC721MintableInstance.read.balanceOf([
        ERC721HandlerInstance.address
    ]);
    assert.strictEqual(originChainHandlerBalance, BigInt(1));
  });

  it("Deposit event is fired with expected value", async () => {
    const depositTx = await BridgeInstance.write.deposit([
      destinationDomainID,
      resourceID,
      depositData,
      feeData
    ],
      {
        account: depositor.account
      }
    );

    const expectedMetaData = toHex(genericBytes);

    await expect(depositTx).to.emit(BridgeInstance, "Deposit").withArgs(
      destinationDomainID,
      resourceID.toLowerCase(),
      expectedDepositNonce,
      depositor,
      depositData.toLowerCase(),
      expectedMetaData
    );
  });

  it("Deposit destination domain can not be current bridge domain ", async () => {
    await expect(
      BridgeInstance.write.deposit([originDomainID, "0x00", depositData, feeData],
        {
          account: depositor.account,
        }
      ),
    ).to.be.revertedWithCustomError(BridgeInstance, "DepositToCurrentDomain()");
  });
});
