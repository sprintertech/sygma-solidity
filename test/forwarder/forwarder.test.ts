// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import 'viem/window';
import {createPublicClient, createTestClient, createWalletClient, custom, getAddress, Hex, http, parseEther, publicActions, TestClient, walletActions, WalletClient} from "viem";
import { hardhat, localhost } from 'viem/chains'
import {generatePrivateKey, toAccount, privateKeyToAccount} from 'viem/accounts';
import {assert, expect} from 'chai';
import {deploySourceChainContracts, getBalance, trimPrefix} from '../helpers';
import {ContractTypesMap} from 'hardhat/types';
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {signTypedData, SignTypedDataVersion} from '@metamask/eth-sig-util';


describe("Forwarder", () => {
  const relayer1PrivKey = generatePrivateKey();
  const relayer2PrivKey = generatePrivateKey();
  const relayer3PrivKey = generatePrivateKey();

  const relayer1Account = privateKeyToAccount(relayer1PrivKey);
  const relayer2Account = privateKeyToAccount(relayer2PrivKey);
  const relayer3Account = privateKeyToAccount(relayer3PrivKey);

  const relayer1Address = relayer1Account.address;
  const relayer2Address = relayer2Account.address;
  const relayer3Address = relayer3Account.address;

  const expectedNonce = BigInt(0);

  const client = createPublicClient({
    chain: hardhat,
    transport: http(),
  }).extend(walletActions)

  const name = "Forwarder" as string;
  const primaryType = "ForwardRequest";

  const EIP712Domain = [
    {name: "name", type: "string"},
    {name: "version", type: "string"},
    {name: "chainId", type: "uint256"},
    {name: "verifyingContract", type: "address"},
  ];

  let domain: {
    name: string,
    chainId: number,
    verifyingContract: Hex,
  };

  const types = {
    EIP712Domain: EIP712Domain,
    ForwardRequest: [
      {name: "from", type: "address"},
      {name: "to", type: "address"},
      {name: "value", type: "uint256"},
      {name: "gas", type: "uint256"},
      {name: "nonce", type: "uint256"},
      {name: "data", type: "bytes"},
    ],
  };

  let ForwarderInstance: ContractTypesMap["Forwarder"];
  let TestTargetInstance: ContractTypesMap["TestTarget"];

  let signature: Hex;
  let request: {
    from: Hex,
    to: Hex,
    value: bigint,
    gas: bigint,
    nonce: bigint,
    data: Hex,
  };

  beforeEach(async () => {
    ({
      ForwarderInstance,
      TestTargetInstance,
    } = await loadFixture(deploySourceChainContracts));
    const [account] = await client.getAddresses();

    await client.sendTransaction({
      account,
      to: relayer2Address,
      value: parseEther("0.1"),
    });
    await client.sendTransaction({
      account,
      to: relayer2Address,
      value: parseEther("0.1"),
    });
    await client.sendTransaction({
      account,
      to: relayer3Address,
      value: parseEther("0.1"),
    });

    domain = {
      name,
      chainId: 1,
      verifyingContract: ForwarderInstance.address
    };

    request = {
      from: relayer1Address,
      to: TestTargetInstance.address,
      value: BigInt(0),
      gas: BigInt(300000),
      nonce: expectedNonce,
      data: "0x" as unknown as Hex,
    };

    signature = signTypedData({
      privateKey: Buffer.from(relayer1PrivKey),
      data: {
        types: types,
        domain: domain,
        primaryType: primaryType,
        message: request,
      },
      version: SignTypedDataVersion.V3,
    }) as Hex
  });

  it(`In case of invalid request(from),
      it should not be verified and should be reverted in executing of the forwarder contract`, async () => {
    const request_other = {
      from: relayer2Address,
      to: TestTargetInstance.address,
      value: BigInt(0),
      gas: BigInt(300000),
      nonce: expectedNonce,
      data: "0x" as unknown as Hex,
    };

    assert.equal(await ForwarderInstance.read.verify([request_other, signature]), false);
    await expect(ForwarderInstance.write.execute([request_other, signature])).to.be.revertedWith(
      "MinimalForwarder: signature does not match request"
    );
  });

  it(`In case of invalid request(to),
      it should not be verified and should be reverted in executing of the forwarder contract`, async () => {
    const request_other = {
      from: relayer1Address,
      to: relayer2Address,
      value: BigInt(0),
      gas: BigInt(300000),
      nonce: expectedNonce,
      data: "0x" as unknown as Hex,
    };

    assert.equal(await ForwarderInstance.read.verify([request_other, signature]), false);
    await expect(ForwarderInstance.write.execute([request_other, signature])).to.be.revertedWith(
      "MinimalForwarder: signature does not match request"
    );
  });

  it(`In case of invalid request(value),
      it should not be verified and should be reverted in executing of the forwarder contract`, async () => {
    const request_other = {
      from: relayer1Address,
      to: TestTargetInstance.address,
      value: BigInt(1),
      gas: BigInt(300000),
      nonce: expectedNonce,
      data: "0x" as unknown as Hex,
    };

    assert.equal(await ForwarderInstance.read.verify([request_other, signature]), false);
    await expect(ForwarderInstance.write.execute([request_other, signature])).to.be.revertedWith(
      "MinimalForwarder: signature does not match request"
    );
  });

  it(`In case of invalid request(gas),
      it should not be verified and should be reverted in executing of the forwarder contract`, async () => {
    const request_other = {
      from: relayer1Address,
      to: TestTargetInstance.address,
      value: BigInt(0),
      gas: BigInt(50000),
      nonce: expectedNonce,
      data: "0x" as unknown as Hex,
    };

    assert.equal(await ForwarderInstance.read.verify([request_other, signature]), false);
    await expect(ForwarderInstance.write.execute([request_other, signature])).to.be.revertedWith(
      "MinimalForwarder: signature does not match request"
    );
  });

  it(`In case of invalid request(nonce),
      it should not be verified and should be reverted in executing of the forwarder contract`, async () => {
    const request_other = {
      from: relayer1Address,
      to: TestTargetInstance.address,
      value: BigInt(0),
      gas: BigInt(300000),
      nonce: BigInt(1),
      data: "0x" as unknown as Hex,
    };

    assert.equal(await ForwarderInstance.read.verify([request_other, signature]), false);
    await expect(ForwarderInstance.write.execute([request_other, signature])).to.be.revertedWith(
      "MinimalForwarder: signature does not match request"
    );
  });

  it(`In case of invalid request(data),
      it should not be verified and should be reverted in executing of the forwarder contract`, async () => {
    const request_other = {
      from: relayer1Address,
      to: TestTargetInstance.address,
      value: BigInt(0),
      gas: BigInt(300000),
      nonce: expectedNonce,
      data: "0x1234" as unknown as Hex,
    };

    assert.equal(await ForwarderInstance.read.verify([request_other, signature]), false);
    await expect(ForwarderInstance.write.execute([request_other, signature])).to.be.revertedWith(
      "MinimalForwarder: signature does not match request"
    );
  });

  it("If signature is valid, but req.from != client, it should be reverted and should not be verified", async () => {
    const sign_other = signTypedData({
      privateKey: Buffer.from(relayer1PrivKey),
      data: {
        types: types,
        domain: domain,
        primaryType: primaryType,
        message: request,
      },
      version: SignTypedDataVersion.V3,
    }) as Hex;

    assert.equal(await ForwarderInstance.read.verify([request, sign_other]), false);
    await expect(ForwarderInstance.write.execute([request, sign_other])).to.be.revertedWith(
      "MinimalForwarder: signature does not match request"
    );
  });

  it(`If signature is valid,
      but req.nonce != nonce[client], it should be reverted and should not be verified`, async () => {
    const request_other = {
      from: relayer1Address,
      to: TestTargetInstance.address,
      value: BigInt(0),
      gas: BigInt(300000),
      nonce: BigInt(10),
      data: "0x" as unknown as Hex,
    };

    const sign_other = signTypedData({
      privateKey: Buffer.from(relayer1PrivKey),
      data: {
        types: types,
        domain: domain,
        primaryType: "ForwardRequest",
        message: request_other,
      },
      version: SignTypedDataVersion.V3,
    }) as Hex;

    assert.equal(
      await ForwarderInstance.read.verify([request_other, sign_other]),
      false
    );
    await expect(ForwarderInstance.write.execute([request_other, sign_other])).to.be.revertedWith(
      "MinimalForwarder: signature does not match request"
    );
  });

  it("Execute should succeed even if the call to the target failed", async () => {
    const new_request = {
      from: relayer1Address,
      to: ForwarderInstance.address,
      value: BigInt(0),
      gas: BigInt(300000),
      nonce: expectedNonce,
      data: "0x" as unknown as Hex,
    };

    const new_sign = signTypedData({
      privateKey: Buffer.from(relayer1PrivKey),
      data: {
        types: types,
        domain: domain,
        primaryType: "ForwardRequest",
        message: new_request,
      },
      version: SignTypedDataVersion.V3,
    }) as Hex;

    const result = await ForwarderInstance.write.execute([new_request, new_sign]);
    assert.equal(Boolean(result[0]), false);
  });

  it("Should be failed in case of execute is called with less gas than req.gas", async () => {
    const new_request = {
      from: relayer3Address,
      to: TestTargetInstance.address,
      value: BigInt(0),
      gas: BigInt(300000),
      nonce: expectedNonce,
      data: "0x" as unknown as Hex,
    };

    const new_sign = signTypedData({
      privateKey: Buffer.from(relayer3PrivKey),
      data: {
        types: types,
        domain: domain,
        primaryType: "ForwardRequest",
        message: new_request,
      },
      version: SignTypedDataVersion.V3,
    }) as Hex;

    await TestTargetInstance.write.setBurnAllGas();
    await expect(
      ForwarderInstance.write.execute([new_request, new_sign], {gas: BigInt(100000)})
    ).to.be.rejected;
  });

  it("req.gas should be passed to the target contract", async () => {
    const requestGas = BigInt(100000);
    const new_request = {
      from: relayer3Address,
      to: TestTargetInstance.address,
      value: BigInt(0),
      gas: requestGas,
      nonce: expectedNonce,
      data: "0x" as unknown as Hex,
    };

    const new_sign = signTypedData({
      privateKey: Buffer.from(relayer3PrivKey),
      data: {
        types: types,
        domain: domain,
        primaryType: "ForwardRequest",
        message: new_request,
      },
      version: SignTypedDataVersion.V3,
    }) as Hex;

    await ForwarderInstance.write.execute([new_request, new_sign], {gas: BigInt(200000)});
    const availableGas = await TestTargetInstance.read.gasLeft();
    assert(availableGas > 96000);
    assert(availableGas < requestGas);
  });

  it("req.data should be passed to the target contract along with the req.from at the end", async () => {
    const requestData = "0x1234" as unknown as Hex;
    const new_request = {
      from: relayer3Address,
      to: TestTargetInstance.address,
      value: BigInt(0),
      gas: BigInt(300000),
      nonce: expectedNonce,
      data: requestData,
    };

    const new_sign = signTypedData({
      privateKey: Buffer.from(relayer3PrivKey),
      data: {
        types: types,
        domain: domain,
        primaryType: "ForwardRequest",
        message: new_request,
      },
      version: SignTypedDataVersion.V3,
    }) as Hex;
    await ForwarderInstance.write.execute([new_request, new_sign]);
    const callData = await TestTargetInstance.read.data();
    const expectedData = requestData + trimPrefix(relayer3Address);
    assert.equal(callData, expectedData);
  });

  it("req.value should be passed to the target contract", async () => {
    const request_value = parseEther("0.1");
    const new_request = {
      from: relayer3Address,
      to: TestTargetInstance.address,
      value: request_value,
      gas: BigInt(300000),
      nonce: expectedNonce,
      data: "0x" as unknown as Hex,
    };

    const new_sign = signTypedData({
      privateKey: Buffer.from(relayer3PrivKey),
      data: {
        types: types,
        domain: domain,
        primaryType: "ForwardRequest",
        message: new_request,
      },
      version: SignTypedDataVersion.V3,
    }) as Hex;
    await ForwarderInstance.write.execute([new_request, new_sign], {
      value: parseEther("0.3"),
    });
    const targetContract_balance = getBalance(
      TestTargetInstance
    );
    assert.equal(
      (await targetContract_balance).toString(),
      request_value.toString()
    );
  });

  it("The successful execute can not be replayed again", async () => {
    await ForwarderInstance.write.execute([request, signature]);
    await expect(ForwarderInstance.write.execute([request, signature])).to.be.revertedWith(
      "MinimalForwarder: signature does not match request"
    );
  });

  it("Only a single call to the target is performed during the execution", async () => {
    await ForwarderInstance.write.execute([request, signature]);
    const calls = await TestTargetInstance.read.calls();
    assert.equal(calls, BigInt(1));
  });

  it("In case of request is matched with signature, it should be verified", async () => {
    assert.equal(await ForwarderInstance.read.verify([request, signature]), true);
  });

  it("In case of request is matched with signature, it should not be reverted and nonce should be increased", async () => {
    const nonce_before_execute = await ForwarderInstance.read.getNonce([
      relayer1Address
    ]);
    await ForwarderInstance.write.execute([request, signature]);
    const nonce_after_execute = await ForwarderInstance.read.getNonce([
      relayer1Address
    ]);
    assert.equal(
      nonce_after_execute,
      nonce_before_execute + BigInt(1)
    );
  });
});
