// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {ContractTypesMap} from "hardhat/types";
import {deploySourceChainContracts, mpcAddress} from "../../helpers";
import {Hex, WalletClient} from "viem";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {assert} from 'chai';




describe("ERC1155Handler - [Deposit Burn ERC1155]", () => {
  const originDomainID = 1;
  const destinationDomainID = 2;

  const tokenID = BigInt(1);
  const tokenAmount = BigInt(100);

  const feeData = "0x";
  const emptySetResourceData = "0x";

  let BridgeInstance: ContractTypesMap["Bridge"];
  let ERC1155MintableInstance1: ContractTypesMap["ERC1155PresetMinterPauser"];
  let ERC1155MintableInstance2: ContractTypesMap["ERC1155PresetMinterPauser"];
  let ERC1155HandlerInstance: ContractTypesMap["ERC1155Handler"];

  let depositor: WalletClient;
  let resourceID1: Hex;
  let resourceID2: Hex;
  let depositData: Hex;
  let burnableContractAddresses: Array<Hex>;

  before(async () => {
    ({
      BridgeInstance,
      ERC1155HandlerInstance,
      ERC1155MintableInstance: ERC1155MintableInstance1,
      ERC1155MintableInstance: ERC1155MintableInstance2,
    } = await loadFixture(deploySourceChainContracts));
    [
      admin,
      depositor,
    ] = await hre.viem.getWalletClients();

    resourceID1 = createResourceID(
      ERC1155MintableInstance1.address,
      originDomainID
    );
    resourceID2 = createResourceID(
      ERC1155MintableInstance2.address,
      originDomainID
    );
    burnableContractAddresses = [ERC1155MintableInstance1.address];

    await ERC1155MintableInstance1.write.mintBatch([
      depositor,
      [tokenID],
      [tokenAmount],
      "0x0"
    ]);

    await ERC1155MintableInstance1.write.setApprovalForAll([
      ERC1155HandlerInstance.address,
      true
    ],
      {
        account: depositor.account
      }
    );
    await BridgeInstance.write.adminSetResource([
      ERC1155HandlerInstance.address,
      resourceID1,
      ERC1155MintableInstance1.address,
      emptySetResourceData
    ]);
    await BridgeInstance.write.adminSetResource([
      ERC1155HandlerInstance.address,
      resourceID2,
      ERC1155MintableInstance2.address,
      emptySetResourceData
    ]);
    await BridgeInstance.write.adminSetBurnable([
      ERC1155HandlerInstance.address,
      ERC1155MintableInstance1.address
    ]);

    depositData = createERC1155DepositData([tokenID], [tokenAmount]);

    // set MPC address to unpause the Bridge
    await BridgeInstance.write.endKeygen([mpcAddress]);
  });

  it("[sanity] burnableContractAddresses should be marked as burnable", async () => {
    for (const burnableAddress of burnableContractAddresses) {
      const isBurnable = (await ERC1155HandlerInstance.read._tokenContractAddressToTokenProperties([
        burnableAddress
      ]));

      assert.isTrue(isBurnable, "Contract wasn't successfully marked burnable");
    }
  });

  it("depositAmount of ERC1155MintableInstance1 tokens should have been burned", async () => {
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

    const handlerBalance = await ERC1155MintableInstance1.read.balanceOf([
      ERC1155HandlerInstance.address,
      tokenID
    ]);
    assert.strictEqual(handlerBalance, BigInt(0));

    const depositorBalance = await ERC1155MintableInstance1.read.balanceOf([
      depositor.account!.address,
      tokenID
    ]);
    assert.strictEqual(depositorBalance, BigInt(0));
  });
});
