// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only


import hre from "hardhat";
import { assert, expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { WalletClient, Address, Hex, zeroAddress, toHex} from "viem";
import { ContractTypesMap } from "hardhat/types";
import {blankFunctionDepositorOffset, blankFunctionSig, constructGenericHandlerSetResourceData, createERCWithdrawData, createMessageCallData, createResourceID, deployDestinationChainContracts, deploySourceChainContracts, mpcAddress} from '../helpers';

// This test does NOT include all getter methods, just
// getters that should work with only the constructor called
describe("Bridge - [admin]", () => {
  const domainID = 1;

  const someAddress: Address = "0xcafecafecafecafecafecafecafecafecafecafe";
  const topologyHash = "549f715f5b06809ada23145c2dc548db";
  const txHash =
    "0x59d881e01ca682130e550e3576b6de760951fb45b1d5dd81342132f57920bbfa";
  const emptySetResourceData = "0x";
  const depositAmount = BigInt(10);

  let DefaultMessageReceiverInstance: ContractTypesMap["DefaultMessageReceiver"];
  let BridgeInstance: ContractTypesMap["Bridge"];
  let ERC20MintableInstance: ContractTypesMap["ERC20PresetMinterPauser"];
  let ERC20HandlerInstance: ContractTypesMap["ERC20Handler"];
  let ERC1155MintableInstance: ContractTypesMap["ERC1155PresetMinterPauser"];
  let ERC1155HandlerInstance: ContractTypesMap["ERC1155Handler"];
  let ERC721MintableInstance: ContractTypesMap["ERC721MinterBurnerPauser"];
  let ERC721HandlerInstance: ContractTypesMap["ERC721Handler"];

  let authorizedAddress: WalletClient;
  let nonadmin: WalletClient;

  let genericHandlerSetResourceData: Hex;
  let withdrawData: Hex;

  beforeEach(async () => {
    ({
      DefaultMessageReceiverInstance,
      BridgeInstance,
      ERC20MintableInstance,
      ERC20HandlerInstance,
      ERC1155MintableInstance,
      ERC1155HandlerInstance,
      ERC721MintableInstance,
      ERC721HandlerInstance
    } = await loadFixture(deploySourceChainContracts));
    [authorizedAddress, nonadmin] = await hre.viem.getWalletClients();

    genericHandlerSetResourceData =
    constructGenericHandlerSetResourceData(
      blankFunctionSig,
      blankFunctionDepositorOffset,
      blankFunctionSig
    );
  });

  // Testing pauseable methods

  it("Bridge should not be paused after MPC address is set", async () => {
    await BridgeInstance.write.endKeygen([mpcAddress]);
    assert.isFalse(await BridgeInstance.read.paused());
  });

  it("Bridge should be paused after being paused by admin", async () => {
    // set MPC address to unpause the Bridge
    await BridgeInstance.write.endKeygen([mpcAddress]);

    await expect(BridgeInstance.write.adminPauseTransfers()).not.to.be.reverted;
    assert.isTrue(await BridgeInstance.read.paused());
  });

  it("Bridge should be unpaused after being paused by admin", async () => {
    // set MPC address to unpause the Bridge
    await BridgeInstance.write.endKeygen([mpcAddress]);

    await expect(BridgeInstance.write.adminPauseTransfers()).not.to.be.reverted;
    assert.isTrue(await BridgeInstance.read.paused());
    await expect(BridgeInstance.write.adminUnpauseTransfers()).not.to.be.reverted;
    assert.isFalse(await BridgeInstance.read.paused());
  });

  // Testing starKeygen, endKeygen and refreshKey methods

  it("Should successfully emit \"StartKeygen\" event if called by admin", async () => {
    await expect(BridgeInstance.write.startKeygen()).to.emit(BridgeInstance, "StartKeygen");
  });

  it("Should fail if \"StartKeygen\" is called by non admin", async () => {
    await expect(BridgeInstance.write.startKeygen({
        account: nonadmin.account?.address
      })).to.be.revertedWithCustomError(BridgeInstance, "AccessNotAllowed(address,bytes4)");
  });

  it("Should fail if \"StartKeygen\" is called after MPC address is set", async () => {
    await BridgeInstance.write.endKeygen([mpcAddress]);

    await expect(BridgeInstance.write.startKeygen(),
      ).to.be.revertedWithCustomError(BridgeInstance, "MPCAddressAlreadySet()");
  });

  it("Should successfully set MPC address and emit \"EndKeygen\" event if called by admin", async () => {
    await expect(BridgeInstance.write.endKeygen([mpcAddress])).to.emit(BridgeInstance, "EndKeygen");

    assert.equal(await BridgeInstance.read._MPCAddress(), mpcAddress);

  });

  it("Should fail if \"endKeygen\" is called by non admin", async () => {
      await expect(BridgeInstance.write.endKeygen(
        [
          someAddress,
        ],
        {account: nonadmin.account?.address}
      )).to.be.revertedWithCustomError(BridgeInstance, "AccessNotAllowed(address,bytes4)")
  });

  it("Should fail if null address is passed as MPC address", async () => {
    await expect(
      BridgeInstance.write.endKeygen([zeroAddress])
    ).to.be.revertedWithCustomError(BridgeInstance, "MPCAddressZeroAddress()");
  });

  it("Should fail if admin tries to update MPC address", async () => {
    await BridgeInstance.write.endKeygen([mpcAddress]);

    await expect(
      BridgeInstance.write.endKeygen([someAddress])
    ).to.be.revertedWithCustomError(BridgeInstance, "MPCAddressIsNotUpdatable()");
  });

  it("Should successfully emit \"KeyRefresh\" event with expected hash value if called by admin", async () => {
    await expect(BridgeInstance.write.refreshKey([topologyHash])).to.emit(BridgeInstance, "KeyRefresh");
  });

  it("Should fail if \"refreshKey\" is called by non admin", async () => {
    await expect(BridgeInstance.write.refreshKey([topologyHash],{
      account: nonadmin.account?.address
    })).to.be.revertedWithCustomError(BridgeInstance, "AccessNotAllowed(address,bytes4)");
  });

  // Set Handler Address

  it("Should set a Resource ID for handler address", async () => {
    const resourceID = createResourceID(
      ERC20MintableInstance.address,
      domainID
    );

    assert.equal(
      await BridgeInstance.read._resourceIDToHandlerAddress([resourceID]),
      zeroAddress
    );

    await expect(
      BridgeInstance.write.adminSetResource(
        [
          ERC20HandlerInstance.address,
          resourceID,
          ERC20MintableInstance.address,
          genericHandlerSetResourceData
        ]
      )
    ).not.to.be.reverted;
    assert.equal(
      (await BridgeInstance.read._resourceIDToHandlerAddress([resourceID])).toLowerCase(),
      ERC20HandlerInstance.address.toLowerCase()
    );
  });

  // Set resource ID

  it("Should set a ERC20 Resource ID and contract address", async () => {
    const resourceID = createResourceID(
      ERC20MintableInstance.address,
      domainID
    );

    await expect(
      BridgeInstance.write.adminSetResource(
        [
          ERC20HandlerInstance.address,
          resourceID,
          ERC20MintableInstance.address,
          genericHandlerSetResourceData
        ]
      )
    ).not.to.be.reverted;
    assert.equal(
      (await ERC20HandlerInstance.read._resourceIDToTokenContractAddress(
        [resourceID]
      )).toLowerCase(),
      ERC20MintableInstance.address.toLowerCase()
    );

    const retrievedResourceID = (await ERC20HandlerInstance.read._tokenContractAddressToTokenProperties(
      [ERC20MintableInstance.address]
    ))

    assert.equal(
      retrievedResourceID[0],
      resourceID
    );
  });

  it("Should require admin role to set a ERC20 Resource ID and contract address", async () => {
    await expect(BridgeInstance.write.refreshKey([topologyHash],{
      account: nonadmin.account?.address
    })).to.be.revertedWithCustomError(BridgeInstance, "AccessNotAllowed(address,bytes4)");

      BridgeInstance.write.adminSetResource(
        [
          someAddress,
          toHex(0, {size: 32}),
          someAddress,
          genericHandlerSetResourceData,
        ],
          {account: nonadmin.account?.address}
      )
  });

  it("should revert when setting resourceID if token doesn't support IERC1155", async () => {
    const invalidResourceID = createResourceID(
      ERC1155MintableInstance.address,
      domainID
    );

    await expect(
      BridgeInstance.write.adminSetResource(
        [
          ERC1155HandlerInstance.address,
          invalidResourceID,
          ERC721MintableInstance.address,
          emptySetResourceData
        ]
      ),
    ).to.be.revertedWith("token does not support IERC1155");
  });

  it("should successfully set resourceID if token supports IERC1155", async () => {
    const resourceID = createResourceID(
      ERC1155MintableInstance.address,
      domainID
    );

    await expect(
      BridgeInstance.write.adminSetResource(
        [
          ERC1155HandlerInstance.address,
          resourceID,
          ERC1155MintableInstance.address,
          emptySetResourceData
        ]
      )
    ).not.to.be.reverted
  });

  // Set burnable

  it("Should set ERC20MintableInstance as burnable", async () => {
    const resourceID = createResourceID(
      ERC20MintableInstance.address,
      domainID
    );

    await expect(
      BridgeInstance.write.adminSetResource(
        [
          ERC20HandlerInstance.address,
          resourceID,
          ERC20MintableInstance.address,
          genericHandlerSetResourceData
        ]
      )
    ).not.to.be.reverted;
    await expect(
      BridgeInstance.write.adminSetBurnable(
        [
          ERC20HandlerInstance.address,
          ERC20MintableInstance.address
        ]
      )
    ).not.to.be.reverted;
    const isBurnable = (await ERC20HandlerInstance.read._tokenContractAddressToTokenProperties(
      [ERC20MintableInstance.address]
    ));

    assert.isTrue(isBurnable[2], "Contract wasn't successfully marked burnable");
  });

  it("Should require admin role to set ERC20MintableInstance.address as burnable", async () => {
    await expect(BridgeInstance.write.adminSetBurnable([someAddress, someAddress],{
      account: nonadmin.account?.address
    })).to.be.revertedWithCustomError(BridgeInstance, "AccessNotAllowed(address,bytes4)");
  });

  // Withdraw

  it("Should withdraw funds", async () => {
    const numTokens = BigInt(10);
    const tokenOwner = authorizedAddress.account!.address;

    let ownerBalance;

    const resourceID = createResourceID(
      ERC20MintableInstance.address,
      domainID
    );

    await expect(
      BridgeInstance.write.adminSetResource(
        [
          ERC20HandlerInstance.address,
          resourceID,
          ERC20MintableInstance.address,
          genericHandlerSetResourceData
        ]
      )
    ).not.to.be.reverted;

    await ERC20MintableInstance.write.mint([tokenOwner, numTokens]);
    ownerBalance = await ERC20MintableInstance.read.balanceOf([tokenOwner]);
    assert.equal(ownerBalance, numTokens);

    await ERC20MintableInstance.write.transfer(
      [ERC20HandlerInstance.address,
      numTokens]
    );

    ownerBalance = await ERC20MintableInstance.read.balanceOf([tokenOwner]);
    assert.equal(ownerBalance, BigInt(0));
    const handlerBalance = await ERC20MintableInstance.read.balanceOf(
      [ERC20HandlerInstance.address]
    );
    assert.equal(handlerBalance, numTokens);

    withdrawData = createERCWithdrawData(
        ERC20MintableInstance.address,
        tokenOwner,
        numTokens
    );

    await BridgeInstance.write.adminWithdraw(
      [
        ERC20HandlerInstance.address,
        withdrawData
      ]
    );
    ownerBalance = await ERC20MintableInstance.read.balanceOf([tokenOwner]);
    assert.equal(ownerBalance, numTokens);
  });

  it("Should allow to withdraw funds if called by authorized address", async () => {
    const tokenOwner = authorizedAddress.account!.address;
    await ERC20MintableInstance.write.mint([ERC20HandlerInstance.address, depositAmount])

    expect(await ERC20HandlerInstance.read.hasRole(
      [
        await ERC20HandlerInstance.read.LIQUIDITY_MANAGER_ROLE(),
        tokenOwner
      ]
    )).to.be.equal(false);

    await ERC20HandlerInstance.write.grantRole(
      [
        await ERC20HandlerInstance.read.LIQUIDITY_MANAGER_ROLE(),
        authorizedAddress.account!.address,
      ],
    );

    const recipientBalanceBefore = await ERC20MintableInstance.read.balanceOf([tokenOwner]);
    const withdrawData = createERCWithdrawData(
      ERC20MintableInstance.address,
      tokenOwner,
      depositAmount,
    );

    await expect(
      ERC20HandlerInstance.write.withdraw([withdrawData], {account: authorizedAddress.account})
    ).not.to.be.reverted;
    const recipientBalanceAfter = await ERC20MintableInstance.read.balanceOf([tokenOwner]);

    expect(
      depositAmount + recipientBalanceBefore
    ).to.be.equal(recipientBalanceAfter);
  });

  // Set nonce

  it("Should set nonce", async () => {
    const nonce = BigInt(3);
    await BridgeInstance.write.adminSetDepositNonce([domainID, nonce]);
    const nonceAfterSet = await BridgeInstance.read._depositCounts([domainID]);
    assert.equal(nonceAfterSet, nonce);
  });

  it("Should require admin role to set nonce", async () => {
    const nonce = BigInt(3);
    await expect(BridgeInstance.write.adminSetDepositNonce([domainID, nonce],{
      account: nonadmin.account?.address
    })).to.be.revertedWithCustomError(BridgeInstance, "AccessNotAllowed(address,bytes4)");
  });

  it("Should not allow for decrements of the nonce", async () => {
    const currentNonce = BigInt(3);
    await BridgeInstance.write.adminSetDepositNonce([domainID, currentNonce]);
    const newNonce = BigInt(2);

    await expect(
      BridgeInstance.write.adminSetDepositNonce([domainID, newNonce])
    ).to.be.revertedWith("Does not allow decrements of the nonce");
  });

  // Change access control contract

  it("Should require admin role to change access control contract", async () => {
    await expect(
      BridgeInstance.write.adminChangeAccessControl([someAddress],{account: nonadmin.account}),
    ).to.be.revertedWithCustomError(BridgeInstance, "AccessNotAllowed(address,bytes4)");
  });

  // Retry

  it("Should require admin role to retry deposit", async () => {
    await expect(
      BridgeInstance.write.retry([txHash],{account: nonadmin.account}),
    ).to.be.revertedWithCustomError(BridgeInstance, "AccessNotAllowed(address,bytes4)");
  });

  it("Should successfully emit Retry event", async () => {
    const eventTx = await BridgeInstance.write.retry([txHash]);

    await expect(BridgeInstance.write.retry([txHash], {
      account: authorizedAddress.account
    })).to.emit(BridgeInstance, "Retry").withArgs(txHash);
  });
});
