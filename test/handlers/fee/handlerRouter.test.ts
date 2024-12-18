// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {ContractTypesMap} from "hardhat/types";
import {Hex, parseEther, WalletClient, zeroAddress} from "viem";
import {createERCDepositData, createResourceID, deploySourceChainContracts} from "../../helpers";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {assert, expect} from 'chai';


describe("FeeHandlerRouter", () => {
  const originDomainID = 1;
  const destinationDomainID = 2;
  const feeData = "0x";
  const depositAmount = BigInt(100);

  let BridgeInstance: ContractTypesMap["Bridge"];
  let FeeHandlerRouterInstance: ContractTypesMap["FeeHandlerRouter"];
  let BasicFeeHandlerInstance: ContractTypesMap["BasicFeeHandler"];
  let ERC20MintableInstance: ContractTypesMap["ERC20PresetMinterPauser"];

  let recipient: WalletClient;
  let nonAdmin: WalletClient;
  let whitelistAddress: WalletClient
  let nonWhitelistAddress: WalletClient;
  let feeHandlerMock: WalletClient;
  let bridgeMock: WalletClient

  let resourceID: Hex

  beforeEach(async () => {
    ({
      BridgeInstance,
      ERC20MintableInstance,
      FeeHandlerRouterInstance,
      BasicFeeHandlerInstance,
    } = await loadFixture(deploySourceChainContracts));
    [
      ,
      recipient,
      whitelistAddress,
      nonWhitelistAddress,
      nonAdmin,
      feeHandlerMock
    ] = await hre.viem.getWalletClients();

    resourceID = createResourceID(
      ERC20MintableInstance.address,
      originDomainID
    );
  });

  it("[sanity] should return fee handler router type", async () => {
    assert.equal(await FeeHandlerRouterInstance.read.feeHandlerType(), "router");
  });

  it("should successfully set handler to resourceID", async () => {
    assert.equal(
      await FeeHandlerRouterInstance.read._domainResourceIDToFeeHandlerAddress([
        destinationDomainID,
        resourceID
      ]),
      zeroAddress
    );
    await FeeHandlerRouterInstance.write.adminSetResourceHandler([
      destinationDomainID,
      resourceID,
      feeHandlerMock.account!.address
    ]);
    const newFeeHandler =
      await FeeHandlerRouterInstance.read._domainResourceIDToFeeHandlerAddress([
        destinationDomainID,
        resourceID
      ]);
    assert.equal(newFeeHandler, feeHandlerMock.account!.address);
  });

  it("should require admin role to set handler for resourceID", async () => {
    await expect(
      FeeHandlerRouterInstance.write.adminSetResourceHandler([
      destinationDomainID,
      resourceID,
      feeHandlerMock.account!.address
    ])).to.be.revertedWith("sender doesn't have admin role");
  });

  it("should successfully set whitelist on an address", async () => {
    assert.equal(
      await FeeHandlerRouterInstance.read._whitelist([
        whitelistAddress.account!.address
      ]),
      false
    );

    const whitelistTx = await FeeHandlerRouterInstance.write.adminSetWhitelist([
      whitelistAddress.account!.address,
      true
    ]);
    assert.equal(
      await FeeHandlerRouterInstance.read._whitelist([
        whitelistAddress.account!.address
      ]),
      true
    );

    await expect(whitelistTx).to.emit(FeeHandlerRouterInstance, "WhitelistChanged").withArgs(
      whitelistAddress.account?.address.toLowerCase(),
      true
    );
  });

  it("should require admin role to set whitelist address", async () => {
    await expect(
      FeeHandlerRouterInstance.write.adminSetWhitelist([
      whitelistAddress.account!.address,
      true],
      {account: nonAdmin.account!.address}
    )).to.be.revertedWith("sender doesn't have admin role");
  });

  it("should return fee 0 if address whitelisted", async () => {
    await FeeHandlerRouterInstance.write.adminSetWhitelist([
      whitelistAddress.account!.address,
      true
    ]);
    await FeeHandlerRouterInstance.write.adminSetResourceHandler([
      destinationDomainID,
      resourceID,
      BasicFeeHandlerInstance.address
    ]);
    await BasicFeeHandlerInstance.write.changeFee([destinationDomainID, resourceID, parseEther("0.5")]);

    const depositData = createERCDepositData(depositAmount, 20, recipient.account!.address);
    let res = await FeeHandlerRouterInstance.read.calculateFee([
      whitelistAddress.account!.address,
      originDomainID,
      destinationDomainID,
      resourceID,
      depositData,
      feeData
    ]);
    assert.equal(web3.utils.fromWei(res[0], "ether"), "0")
    res = await FeeHandlerRouterInstance.read.calculateFee([
      nonWhitelistAddress.account!.address,
      originDomainID,
      destinationDomainID,
      resourceID,
      depositData,
      feeData
    ]);
    assert.equal(web3.utils.fromWei(res[0], "ether"), "0.5")
  });

  it("should revert if whitelisted address provides fee", async () => {
    await FeeHandlerRouterInstance.write.adminSetWhitelist([
      whitelistAddress.account!.address,
      true
    ]);
    await FeeHandlerRouterInstance.write.adminSetResourceHandler([
      destinationDomainID,
      resourceID,
      BasicFeeHandlerInstance.address
    ]);
    await BasicFeeHandlerInstance.write.changeFee([destinationDomainID, resourceID, parseEther("0.5")]);

    const depositData = createERCDepositData(depositAmount, 20, recipient.account!.address);
    await expect(
      FeeHandlerRouterInstance.write.collectFee([
        whitelistAddress.account!.address,
        originDomainID,
        destinationDomainID,
        resourceID,
        depositData,
        feeData],
        {
          account: bridgeMock.account,
          value: parseEther("0.5")
        }
      ),
    ).to.be.revertedWithCustomError(FeeHandlerRouterInstance, "IncorrectFeeSupplied(uint256)");
    await expect(
      FeeHandlerRouterInstance.write.collectFee([
        nonWhitelistAddress.account!.address,
        originDomainID,
        destinationDomainID,
        resourceID,
        depositData,
        feeData],
        {
          account: bridgeMock.account,
          value: parseEther("0.5")
        }
      )
    ).not.to.be.reverted;
  });

  it("should not collect fee from whitelisted address", async () => {
    await FeeHandlerRouterInstance.write.adminSetWhitelist([
      whitelistAddress.account!.address,
      true
    ]);
    await FeeHandlerRouterInstance.write.adminSetResourceHandler([
      destinationDomainID,
      resourceID,
      BasicFeeHandlerInstance.address
    ]);
    await BasicFeeHandlerInstance.write.changeFee([destinationDomainID, resourceID, parseEther("0.5")]);

    const depositData = createERCDepositData(depositAmount, 20, recipient.account!.address);
    await expect(
      FeeHandlerRouterInstance.write.collectFee([
        whitelistAddress.account!.address,
        originDomainID,
        destinationDomainID,
        resourceID,
        depositData,
        feeData],
        {
          account: bridgeMock.account,
          value: BigInt(0)
        }
      ),
    ).not.to.be.reverted;
  });
});
