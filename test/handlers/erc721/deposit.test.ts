// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {concat, Hex, keccak256, WalletClient} from "viem";
import {createERCDepositData, createResourceID, deploySourceChainContracts, mpcAddress, trimPrefix} from "../../helpers";
import {ContractTypesMap} from "hardhat/types";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {assert, expect} from 'chai';



describe("ERC721Handler - [Deposit ERC721]", () => {
  const originDomainID = 1;
  const destinationDomainID = 2;

  const expectedDepositNonce = 1;

  const lenRecipient = 40;
  const tokenID = BigInt(1);
  const feeData = "0x";
  const emptySetResourceData = "0x";

  let BridgeInstance: ContractTypesMap["Bridge"];
  let ERC721MintableInstance: ContractTypesMap["ERC721MinterBurnerPauser"];
  let ERC721HandlerInstance: ContractTypesMap["ERC721Handler"];

  let admin: WalletClient;
  let depositor: WalletClient;
  let recipient: WalletClient;
  let recipient32ByteAddress: Hex;
  let resourceID: Hex;
  let proposalData: Hex;


  before(async () => {
    ({
      BridgeInstance,
      ERC721HandlerInstance,
      ERC721MintableInstance,
    } = await loadFixture(deploySourceChainContracts));
    [
      admin,
      depositor,
    ] = await hre.viem.getWalletClients();

    resourceID = createResourceID(
      ERC721MintableInstance.address,
      originDomainID
    );
    recipient32ByteAddress = concat([admin.account!.address, trimPrefix(recipient.account!.address)]);
    proposalData = createERCDepositData(
      tokenID,
      lenRecipient,
      recipient.account!.address
    )


    await ERC721MintableInstance.write.mint([depositor.account!.address, tokenID, ""]),

    await ERC721MintableInstance.write.approve([ERC721HandlerInstance.address, tokenID
    ],
      {
        account: depositor.account,
      }
    );
    await BridgeInstance.write.adminSetResource([
      ERC721HandlerInstance.address,
      resourceID,
      ERC721MintableInstance.address,
      emptySetResourceData
    ]);

    // set MPC address to unpause the Bridge
    await BridgeInstance.write.endKeygen([mpcAddress]);
  });

  it("[sanity] depositor owns ERC721 with tokenID", async () => {
    const tokenOwner = await ERC721MintableInstance.read.ownerOf([tokenID]);
    assert.equal(depositor.account!.address, tokenOwner);
  });

  it("[sanity] ERC721HandlerInstance.address has an allowance for tokenID", async () => {
    const tokenAllowance = await ERC721MintableInstance.read.getApproved([tokenID]);
    assert.equal(ERC721HandlerInstance.address, tokenAllowance);
  });

  it("Varied recipient address with length 40", async () => {
    const depositTx = await BridgeInstance.write.deposit([
      destinationDomainID,
      resourceID,
      proposalData,
      feeData
    ],
      {
        account: depositor.account
      }
    );

    await expect(depositTx).to.emit(BridgeInstance, "Deposit").withArgs(
      destinationDomainID,
      resourceID.toLowerCase(),
      expectedDepositNonce,
      depositor,
      proposalData,
      null
    );
  });

  it("Varied recipient address with length 32", async () => {
    const recipient = keccak256(admin.account!.address);
    const lenRecipient = 32;
    const proposalData = createERCDepositData(
      tokenID,
      lenRecipient,
      recipient32ByteAddress
    );

    const depositTx = await BridgeInstance.write.deposit([
      destinationDomainID,
      resourceID,
      proposalData,
      feeData
    ],
      {
        account: depositor.account
      }
    );

    await expect(depositTx).to.emit(BridgeInstance, "Deposit").withArgs(
      destinationDomainID,
      resourceID.toLowerCase(),
      expectedDepositNonce,
      depositor,
      proposalData,
      null
    );
  });
});
