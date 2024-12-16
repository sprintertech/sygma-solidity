// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

const fs = require("fs");
const {resolve} = require("path");
import {Hex, toFunctionSelector} from "viem";

type AbiFunction = {
  inputs: Array<Object>,
  name: string,
  outputs: Array<Object>,
  stateMutability: string,
  type: string,
}

const BRIDGE_CONTRACT_PATH = resolve(__dirname, "../contracts/Bridge.sol");
const ARTIFACTS_PATH = resolve(__dirname, "../artifacts/contracts/Bridge.sol/Bridge.json");

export function generateAccessControlFuncSignatures() {
  const bridgeJson = JSON.parse(fs.readFileSync(ARTIFACTS_PATH));
  const bridgeAbi = bridgeJson.abi
  const bridgeContract = fs.readFileSync(BRIDGE_CONTRACT_PATH);

  // regex that will match all functions that have "onlyAllowed" modifier
  const regex = RegExp("function\\s+(?:(?!_onlyAllowed|function).)+onlyAllowed", "gs");

  let item;
  const functionNames:Array<string> = [];
  const functionSignatures:Array<Hex> = [];

  // fetch all functions that have "onlyAllowed" modifier from "Bridge.sol"
  while ((item = regex.exec(bridgeContract)) !== null) {
    // filter out only function name from matching (onlyAllowed) functions
    const funcName = item[0].split(/[\s()]+/)[1];
    functionNames.push(funcName);
  }

  bridgeAbi.forEach((item: AbiFunction) => {
    if (item.name && functionNames.includes(item.name)) {
      functionSignatures.push(toFunctionSelector(item));
    }
  });

  // generate table with function names and sinatures
  const functionSignaturesTable = functionNames.map((functionNames, index) => ({
    Values: functionNames,
    Hex: functionSignatures[index]
  }));

  console.table(functionSignaturesTable);
  return functionSignatures;
}
