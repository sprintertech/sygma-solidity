// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {ContractTypesMap} from "hardhat/types";
import {createERCDepositData, createResourceID, deploySourceChainContracts, mpcAddress} from "../../helpers";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {Hex, WalletClient} from 'viem';
import {assert, expect} from 'chai';



describe("ERC721Handler - [Deposit Burn ERC721]", () => {
  const originDomainID = 1;
  const destinationDomainID = 2;

  const tokenID = BigInt(1);
  const feeData = "0x";
  const emptySetResourceData = "0x";

  let BridgeInstance: ContractTypesMap["Bridge"];
  let ERC721MintableInstance1: ContractTypesMap["ERC721MinterBurnerPauser"];;
  let ERC721MintableInstance2: ContractTypesMap["ERC721MinterBurnerPauser"];;
  let ERC721HandlerInstance: ContractTypesMap["ERC721Handler"];

  let resourceID1: Hex;
  let resourceID2: Hex;
  let burnableContractAddresses: Array<Hex>;
  let depositData: Hex;

  let admin: WalletClient;
  let depositor: WalletClient;
  let recipient: WalletClient;
  let nonTokenOwner: WalletClient;

  beforeEach(async () => {
    ({
      BridgeInstance,
      ERC721HandlerInstance,
      ERC721MintableInstance: ERC721MintableInstance1,
      ERC721MintableInstance: ERC721MintableInstance2,
    } = await loadFixture(deploySourceChainContracts));
    [
      admin,
      depositor,
      recipient,
      nonTokenOwner
    ] = await hre.viem.getWalletClients();


    resourceID1 = createResourceID(
      ERC721MintableInstance1.address,
      originDomainID
    );
    resourceID2 = createResourceID(
      ERC721MintableInstance2.address,
      originDomainID
    );
    burnableContractAddresses = [ERC721MintableInstance1.address];


    await ERC721MintableInstance1.write.mint([depositor.account!.address, tokenID, ""]),

    await ERC721MintableInstance1.write.approve([ERC721HandlerInstance.address, tokenID],
      {
        account: depositor.account,
      }
    );
    await BridgeInstance.write.adminSetResource([
      ERC721HandlerInstance.address,
      resourceID1,
      ERC721MintableInstance1.address,
      emptySetResourceData
    ]);
    await BridgeInstance.write.adminSetResource([
      ERC721HandlerInstance.address,
      resourceID2,
      ERC721MintableInstance2.address,
      emptySetResourceData
    ]);
    await BridgeInstance.write.adminSetBurnable([
      ERC721HandlerInstance.address,
      ERC721MintableInstance1.address
    ]);

    depositData = createERCDepositData(tokenID, 20, recipient.account!.address);

    // set MPC address to unpause the Bridge
    await BridgeInstance.write.endKeygen([mpcAddress]);
  });

  it("[sanity] burnableContractAddresses should be marked as burnable", async () => {
    for (const burnableAddress of burnableContractAddresses) {
      const isBurnable = (await ERC721HandlerInstance.read._tokenContractAddressToTokenProperties([
        burnableAddress
      ]))[0];

      assert.isTrue(isBurnable, "Contract wasn't successfully marked burnable");
    }
  });

  it("[sanity] ERC721MintableInstance1 tokenID has been minted for depositor", async () => {
    const tokenOwner = await ERC721MintableInstance1.read.ownerOf([tokenID]);
    assert.strictEqual(tokenOwner, depositor.account!.address);
  });

  it("depositAmount of ERC721MintableInstance1 tokens should have been burned", async () => {
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

    const handlerBalance = await ERC721MintableInstance1.read.balanceOf([
      ERC721HandlerInstance.address
    ]);
    assert.strictEqual(handlerBalance, BigInt(0));

    const depositorBalance = await ERC721MintableInstance1.read.balanceOf([
      depositor.account!.address
    ]);
    assert.strictEqual(depositorBalance, BigInt(0));

    await expect(
      ERC721MintableInstance1.read.ownerOf([tokenID]),
      "ERC721: owner query for nonexistent token"
    ).to.be.reverted;
  });

  it("depositAmount of ERC721MintableInstance1 tokens should NOT burn from NOT token owner", async () => {
    await expect(
      BridgeInstance.write.deposit([
        destinationDomainID,
        resourceID1,
        depositData,
        feeData
      ],
        {
          account: nonTokenOwner.account
        }
      ),
      "Burn not from owner"
    );
  });
});
