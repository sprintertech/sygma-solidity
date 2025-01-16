import hre from 'hardhat';
import {ContractTypesMap, HardhatRuntimeEnvironment} from 'hardhat/types';
// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only
import { AbiParameter, Account, Address, concat, createPublicClient, encodeAbiParameters, encodePacked, getAddress, GetBalanceParameters, GetContractReturnType, Hex, http, pad, parseAbiItem, parseAbiParameters, size, toBytes, toFunctionSelector, toHex, WalletClient, zeroAddress } from 'viem';
import {generateAccessControlFuncSignatures} from '../scripts/generateFuncSignatures';
import {signTypedData, SignTypedDataVersion} from '@metamask/eth-sig-util';
import {hardhat} from 'viem/chains';
import {Proposal} from '../types';

const publicClient = createPublicClient({
  chain: hardhat,
  transport: http(),
});

export const UNISWAP_V3_FACTORY_ADDRESS = "0x1F98431c8aD98523631AE4a59f267346ea31F984" as Hex;
export const WETH_ADDRESS = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2" as Hex;
export const MATIC_ADDRESS = "0x7d1afa7b718fb893db30a3abc0cfc608aacfebb0" as Hex;
export const BNB_ADDRESS = "0xB8c77482e45F1F44dE1745F52C74426C631bDD52";

export const recoverGas = BigInt(100000);
export const gasUsed = 100000;
export const blankFunctionSig = "0x00000000" as unknown as Hex;
export const blankFunctionDepositorOffset = "0x0000" as unknown as Hex;
export const mpcAddress = "0x1Ad4b1efE3Bc6FEE085e995FCF48219430e615C3" as unknown as Hex;
export const mpcPrivateKey = Buffer.from(
  "497b6ae580cb1b0238f8b6b543fada697bc6f8768a983281e5e52a1a5bca4d58",
  "hex"
);


const accessControlFuncSignatures = generateAccessControlFuncSignatures();


export async function deploySourceChainContracts() {
  const [authorizedAddress] = await hre.viem.getWalletClients();
  const domainID = 1
  const resourceID = toHex(650, {size:32});

  const AccessControlSegregatorInstance = await hre.viem.deployContract("AccessControlSegregator", [
    accessControlFuncSignatures,
    Array(13).fill(authorizedAddress.account.address)
  ]);
  const DefaultMessageReceiverInstance = await hre.viem.deployContract("DefaultMessageReceiver", [[], recoverGas]);
  const BridgeInstance = await hre.viem.deployContract("Bridge", [domainID, AccessControlSegregatorInstance.address]);
  const NativeTokenTransferGatewayInstance = await hre.viem.deployContract("NativeTokenTransferGateway", [BridgeInstance.address, resourceID]);
  const ERC20MintableInstance = await hre.viem.deployContract("ERC20PresetMinterPauser", ["Token", "TOK"]);
  const ERC20HandlerInstance = await hre.viem.deployContract("ERC20Handler", [BridgeInstance.address, DefaultMessageReceiverInstance.address]);
  const ERC1155MintableInstance = await hre.viem.deployContract("ERC1155PresetMinterPauser", ["TOK"]);
  const ERC1155HandlerInstance = await hre.viem.deployContract("ERC1155Handler", [BridgeInstance.address]);
  const ERC721MintableInstance = await hre.viem.deployContract("ERC721MinterBurnerPauser", ["Token", "TOK", ""]);
  const ERC721HandlerInstance = await hre.viem.deployContract("ERC721Handler", [BridgeInstance.address]);
  const FeeHandlerRouterInstance = await hre.viem.deployContract("FeeHandlerRouter", [BridgeInstance.address]);
  const BasicFeeHandlerInstance = await hre.viem.deployContract("BasicFeeHandler", [BridgeInstance.address, FeeHandlerRouterInstance.address]);
  const PercentageFeeHandlerInstance = await hre.viem.deployContract("PercentageERC20FeeHandler", [BridgeInstance.address, FeeHandlerRouterInstance.address]);
  const TwapNativeTokenFeeHandlerInstance = await hre.viem.deployContract("TwapNativeTokenFeeHandler", [BridgeInstance.address, FeeHandlerRouterInstance.address, gasUsed]);
  const TwapOracleInstance = await hre.viem.deployContract("TwapOracle", [UNISWAP_V3_FACTORY_ADDRESS, WETH_ADDRESS]);
  const TwapGenericFeeHandlerInstance = await hre.viem.deployContract("TwapGenericFeeHandler", [BridgeInstance.address, FeeHandlerRouterInstance.address]);
  const GmpHandlerInstance = await hre.viem.deployContract("GmpHandler", [BridgeInstance.address]);
  const NativeTokenHandlerInstance = await hre.viem.deployContract("NativeTokenHandler", [BridgeInstance.address, NativeTokenTransferGatewayInstance.address, DefaultMessageReceiverInstance.address]);
  const TestStoreInstance = await hre.viem.deployContract("TestStore");
  const TestDepositInstance = await hre.viem.deployContract("TestDeposit");
  const XC20TestInstance = await hre.viem.deployContract("XC20Test");
  const XC20HandlerInstance = await hre.viem.deployContract("XC20Handler", [BridgeInstance.address]);
  const HandlerRevert = await hre.viem.deployContract("HandlerRevert", [BridgeInstance.address]);
  const FROSTKeygenInstance = await hre.viem.deployContract("FROSTKeygen");
  const RetryInstance = await hre.viem.deployContract("Retry");
  const WithDepositorInstance = await hre.viem.deployContract("WithDepositor");
  const ReturnDataInstance = await hre.viem.deployContract("ReturnData");
  const ForwarderInstance = await hre.viem.deployContract("Forwarder");
  const TestTargetInstance = await hre.viem.deployContract("TestTarget");


  return {
    DefaultMessageReceiverInstance,
    BridgeInstance,
    NativeTokenTransferGatewayInstance,
    ERC20MintableInstance,
    ERC20HandlerInstance,
    ERC1155MintableInstance,
    ERC1155HandlerInstance,
    ERC721MintableInstance,
    ERC721HandlerInstance,
    FeeHandlerRouterInstance,
    BasicFeeHandlerInstance,
    PercentageFeeHandlerInstance,
    TwapNativeTokenFeeHandlerInstance,
    TwapOracleInstance,
    TwapGenericFeeHandlerInstance,
    NativeTokenHandlerInstance,
    GmpHandlerInstance,
    TestStoreInstance,
    TestDepositInstance,
    XC20TestInstance,
    XC20HandlerInstance,
    HandlerRevert,
    FROSTKeygenInstance,
    RetryInstance,
    WithDepositorInstance,
    ReturnDataInstance,
    ForwarderInstance,
    TestTargetInstance
  };
}

export async function deployDestinationChainContracts(hre: HardhatRuntimeEnvironment) {
  const [authorizedAddress] = await hre.viem.getWalletClients();
  const recoverGas = BigInt(100000);
  const gasUsed = 100000;
  const domainID = 2
  const resourceID = toHex(650, {size:32});

  const AccessControlSegregatorInstance = await hre.viem.deployContract("AccessControlSegregator", [
    accessControlFuncSignatures,
    Array(13).fill(authorizedAddress.account.address)
  ]);
  const DefaultMessageReceiverInstance = await hre.viem.deployContract("DefaultMessageReceiver", [[], recoverGas]);
  const BridgeInstance = await hre.viem.deployContract("Bridge", [domainID, AccessControlSegregatorInstance.address]);
  const NativeTokenTransferGatewayInstance = await hre.viem.deployContract("NativeTokenTransferGateway", [BridgeInstance.address, resourceID]);
  const ERC20MintableInstance = await hre.viem.deployContract("ERC20PresetMinterPauser", ["Token", "TOK"]);
  const ERC20HandlerInstance = await hre.viem.deployContract("ERC20Handler", [BridgeInstance.address, DefaultMessageReceiverInstance.address]);
  const ERC1155MintableInstance = await hre.viem.deployContract("ERC1155PresetMinterPauser", ["TOK"]);
  const ERC1155HandlerInstance = await hre.viem.deployContract("ERC1155Handler", [BridgeInstance.address]);
  const ERC721MintableInstance = await hre.viem.deployContract("ERC721MinterBurnerPauser", ["Token", "TOK", ""]);
  const ERC721HandlerInstance = await hre.viem.deployContract("ERC721Handler", [BridgeInstance.address]);
  const FeeHandlerRouterInstance = await hre.viem.deployContract("FeeHandlerRouter", [BridgeInstance.address]);
  const BasicFeeHandlerInstance = await hre.viem.deployContract("BasicFeeHandler", [BridgeInstance.address, FeeHandlerRouterInstance.address]);
  const PercentageFeeHandlerInstance = await hre.viem.deployContract("PercentageERC20FeeHandler", [BridgeInstance.address, FeeHandlerRouterInstance.address]);
  const TwapNativeTokenFeeHandlerInstance = await hre.viem.deployContract("TwapNativeTokenFeeHandler", [BridgeInstance.address, FeeHandlerRouterInstance.address, gasUsed]);
  const TwapOracleInstance = await hre.viem.deployContract("TwapOracle", [UNISWAP_V3_FACTORY_ADDRESS, WETH_ADDRESS]);
  const TwapGenericFeeHandlerInstance = await hre.viem.deployContract("TwapGenericFeeHandler", [BridgeInstance.address, FeeHandlerRouterInstance.address]);
  const GmpHandlerInstance = await hre.viem.deployContract("GmpHandler", [BridgeInstance.address]);
  const NativeTokenHandlerInstance = await hre.viem.deployContract("NativeTokenHandler", [BridgeInstance.address, NativeTokenTransferGatewayInstance.address, DefaultMessageReceiverInstance.address]);
  const TestStoreInstance = await hre.viem.deployContract("TestStore");
  const TestDepositInstance = await hre.viem.deployContract("TestDeposit");
  const XC20TestInstance = await hre.viem.deployContract("XC20Test");
  const XC20HandlerInstance = await hre.viem.deployContract("XC20Handler", [BridgeInstance.address]);
  const HandlerRevert = await hre.viem.deployContract("HandlerRevert", [BridgeInstance.address]);
  const FROSTKeygenInstance = await hre.viem.deployContract("FROSTKeygen");
  const RetryInstance = await hre.viem.deployContract("Retry");
  const WithDepositorInstance = await hre.viem.deployContract("WithDepositor");
  const ReturnDataInstance = await hre.viem.deployContract("ReturnData");
  const ForwarderInstance = await hre.viem.deployContract("Forwarder");
  const TestTargetInstance = await hre.viem.deployContract("TestTarget");


  return {
    DefaultMessageReceiverInstance,
    BridgeInstance,
    NativeTokenTransferGatewayInstance,
    ERC20MintableInstance,
    ERC20HandlerInstance,
    ERC1155MintableInstance,
    ERC1155HandlerInstance,
    ERC721MintableInstance,
    ERC721HandlerInstance,
    FeeHandlerRouterInstance,
    BasicFeeHandlerInstance,
    PercentageFeeHandlerInstance,
    TwapNativeTokenFeeHandlerInstance,
    TwapOracleInstance,
    TwapGenericFeeHandlerInstance,
    NativeTokenHandlerInstance,
    GmpHandlerInstance,
    TestStoreInstance,
    TestDepositInstance,
    XC20TestInstance,
    XC20HandlerInstance,
    HandlerRevert,
    FROSTKeygenInstance,
    RetryInstance,
    WithDepositorInstance,
    ReturnDataInstance,
    ForwarderInstance,
    TestTargetInstance
  };
}

export function createERCDepositData(
  tokenAmountOrID: bigint,
  lenRecipientAddress: number,
  recipientAddress: Hex
): Hex {
  return concat(
    [
      trimPrefix(toHex(tokenAmountOrID, {size:32})),      // Token amount or ID to deposit (32 bytes)
      trimPrefix(toHex(lenRecipientAddress, {size: 32})), // len(recipientAddress)         (32 bytes)
      trimPrefix(recipientAddress)                        // recipientAddress              (20 bytes)
    ]
  );
};

export function trimPrefix(string: string | Hex):Hex {
  return string.substring(2) as unknown as Hex
}

export function createERCWithdrawData(
  tokenAddress: Hex,
  recipientAddress: Hex,
  tokenAmountOrID: bigint
): Hex {
  return concat(
    [
      trimPrefix(pad(tokenAddress, {size: 32})),
      trimPrefix(pad(recipientAddress, {size: 32})),
      trimPrefix(toHex(tokenAmountOrID, {size: 32}))
    ]
  )
};

export function createERC1155DepositData(
  tokenIDs: Array<bigint>,
  amounts: Array<bigint>
): Hex {
  return encodeAbiParameters(
    parseAbiParameters(
      [
        "uint256[]", "uint256[]"
      ]
    ),
      [tokenIDs, amounts]
  );
};

export function createERC1155DepositProposalData(
  tokenIDs: Array<bigint>,
  amounts: Array<bigint>,
  recipient: Hex,
  transferData: Hex
):Hex {
  return encodeAbiParameters(
    parseAbiParameters(
      ["uint[]", "uint[]", "bytes", "bytes"]
    ),
      [tokenIDs, amounts, recipient, transferData]
  );
};

export function createERC1155WithdrawData(
  tokenAddress: Hex,
  recipient: Hex,
  tokenIDs: Array<bigint>,
  amounts: Array<bigint>,
  transferData: Hex
):Hex {
  return encodeAbiParameters(
    parseAbiParameters(
      ["address", "address", "uint256[]", "uint256[]", "bytes"],
    ),
    [tokenAddress, recipient, tokenIDs, amounts, transferData]
  );
};

export function createERC721DepositProposalData(
  tokenAmountOrID: bigint,
  lenRecipientAddress: number,
  recipientAddress: Hex,
  lenMetaData: number,
  metaData: Hex
): Hex {
  return concat([
    toHex(tokenAmountOrID, {size: 32}),                 // Token amount or ID to deposit (32 bytes)
    trimPrefix(toHex(lenRecipientAddress, {size: 32})), // len(recipientAddress)         (32 bytes)
    trimPrefix(recipientAddress),                       // recipientAddress              (bytes)
    trimPrefix(toHex(lenMetaData, {size: 32})),         // len(metaData)                 (32 bytes)
    trimPrefix(toHex(metaData, {size: lenMetaData}))    // metaData                     (bytes)
  ]);
};

export function createBtcDepositData(
  transferAmount: bigint,
  btcRecipientAddress: string
): Hex{
  return encodePacked(
    ["uint256", "uint256", "string"],
    [transferAmount, BigInt(btcRecipientAddress.length), btcRecipientAddress]
  )
}

export function createGmpDepositData(
  executeFunctionSignature: Hex,
  executeContractAddress: Hex,
  maxFee: bigint,
  depositor: Hex,
  executionData: Hex,
  depositorCheck = true
): Hex {
  if (depositorCheck) {
    // if "depositorCheck" is true -> append depositor address for destination chain check
    executionData = concat([
      executionData,
      trimPrefix(pad(depositor, {size: 32}))
    ])
  }

  return concat([
    toHex(maxFee, {size:32}),                                                     // uint256
    trimPrefix(toHex(trimPrefix(executeFunctionSignature).length / 2, {size:2})), // uint16
    trimPrefix(executeFunctionSignature),                                         // bytes
    trimPrefix(toHex(trimPrefix(executeContractAddress).length / 2, {size:1})),   // uint8
    trimPrefix(executeContractAddress),                                           // bytes
    trimPrefix(toHex(trimPrefix(depositor).length / 2, {size:1})),                // uint8
    trimPrefix(depositor),                                                        // bytes
    trimPrefix(executionData)                                                     // bytes
  ])
};

export function constructGenericHandlerSetResourceData(...args: Array<Hex>) {
  return args.reduce((accumulator, currentArg) => {
    if (typeof currentArg === "number") {
      currentArg = toHex(currentArg, {size:2});
    }
    return accumulator + currentArg.substring(2) as unknown as Hex;
  });
};

export function createResourceID(contractAddress: Hex, domainID: number) {
  return pad(
    concat([
      contractAddress,
      toHex(domainID, {size: 1}),
  ]), {size: 32});
};

export function decimalToPaddedBinary(decimal: bigint): Hex {
  return decimal.toString(2).padStart(64, "0") as unknown as Hex;
};

export function signTypedProposal(bridgeAddress: Hex, proposals: Array<Proposal>, chainId = 1) :Hex {
  const name = "Bridge";

  const EIP712Domain = [
    {name: "name", type: "string"},
    {name: "version", type: "string"},
    {name: "chainId", type: "uint256"},
    {name: "verifyingContract", type: "address"},
  ];

  const types = {
    EIP712Domain: EIP712Domain,
    Proposal: [
      {name: "originDomainID", type: "uint8"},
      {name: "depositNonce", type: "uint64"},
      {name: "resourceID", type: "bytes32"},
      {name: "data", type: "bytes"},
    ],
    Proposals: [{name: "proposals", type: "Proposal[]"}],
  };


  return signTypedData({
    privateKey: mpcPrivateKey,
    data: {
      types: types,
      domain: {
        name,
        version: "3.1.0",
        chainId,
        verifyingContract: bridgeAddress,
      },
      primaryType: "Proposals",
      message: {
        proposals: proposals,
      },
    },
    version: SignTypedDataVersion.V4,
  }) as Hex;
};

export function mockSignTypedProposalWithInvalidChainID (bridgeAddress: Hex, proposals:Array<Proposal>): Hex {
  return signTypedProposal(bridgeAddress, proposals, 3) as Hex;
};

export async function createDepositProposalDataFromHandlerResponse(
  contractAddress: Address,
  depositTx: Hex,
  lenRecipientAddress: number,
  recipientAddress: Hex
):Promise<Hex> {
    const logs = await publicClient.getLogs({
    address: contractAddress,
    event: parseAbiItem('emit Deposit(destinationDomainID, resourceID, depositNonce, sender, depositData, handlerResponse)'),
    strict: true
  });
  const amountFromHandlerResponse = BigInt(logs[0].args.handlerResponse);
  return createERCDepositData(amountFromHandlerResponse, lenRecipientAddress, recipientAddress);
};


// This helper can be used to prepare execution data for GmpHandler
// The execution data will be packed together with depositorAddress before execution.
// If the target function parameters include reference types then the offsets should be kept consistent.
// This function packs the parameters together with a fake address and removes the address.
// After repacking the data in the handler together with depositorAddress, the offsets will be correct.
// Usage: use this function to prepare execution data,
// then pack the result together with executeFunctionSignature, maxFee etc
// (using the createGmpDepositData() helper)
// and then pass the data to Bridge.deposit().
export function createGmpExecutionData(
  types: Array<AbiParameter>,
  values: Array<unknown>
) {
  types.unshift("address" as unknown as AbiParameter);
  const array: AbiParameter[] =  [];

  values.unshift(zeroAddress);
  return encodeAbiParameters(
    parseAbiParameters(
      types
      // ["address", "address", "uint256[]", "uint256[]", "bytes"],
    ),
    values
  );
};

encodeAbiParameters(
  parseAbiParameters(
    ["uint[]", "uint[]", "bytes", "bytes"]
  ),
    [[BigInt(2)], [BigInt(2)], "0x", "0x"]
);

type Action = {
  nativeValue: BigInt,
  callTo: Hex,
  approveTo: Hex,
  tokenSend: Hex,
  tokenReceive: Hex,
  data: Hex,
}

const ACTIONS_ARRAY_ABI =
"tuple(uint256 nativeValue)[]";
// "tuple(uint256 nativeValue, address callTo, address approveTo, address tokenSend, address tokenReceive, bytes data)[]";

export function createMessageCallData(transactionId: Hex, actions: Array<Action>, receiver: Hex) {
  return encodeAbiParameters(
    parseAbiParameters(["bytes32", ACTIONS_ARRAY_ABI, "address"]),
    [
      transactionId,
      actions.map((action: Action) =>  [
        action.nativeValue,
        action.callTo,
        action.approveTo,
        action.tokenSend,
        action.tokenReceive,
        action.data,
      ]),
      receiver
    ]
  )
}

export function createOptionalContractCallDepositData(
  amount: bigint,
  recipient: Hex,
  executionGasAmount: bigint,
  message: Hex
): Hex {
  return concat([
    trimPrefix(toHex(amount, {size:32})),                            // uint256
    trimPrefix(toHex(recipient.substring(2).length / 2, {size:32})), // uint256
    trimPrefix(recipient),                                           // bytes
    trimPrefix(toHex(executionGasAmount, {size:32})),                // uint256
    trimPrefix(toHex(message.substring(2).length / 2, {size:32})),   // uint256
    trimPrefix(message)                                              // bytes
  ])
}

export async function getBalance(args: GetBalanceParameters | WalletClient): Promise<bigint>{
  if(args.hasOwnProperty("account")){
    const wallet = args as WalletClient;
    return await publicClient.getBalance({address: wallet.account!.address });
  } else {
    return await publicClient.getBalance(args as GetBalanceParameters);
  }
}
