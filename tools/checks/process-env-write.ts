import { NodeFlags, SyntaxKind } from "typescript/unstable/ast";
import type {
  BinaryExpression,
  ForOfStatement,
  Node,
  VariableDeclarationList,
} from "typescript/unstable/ast";
import {
  isBinaryExpression,
  isCallExpression,
  isElementAccessExpression,
  isExpressionStatement,
  isForOfStatement,
  isIdentifier,
  isPropertyAccessExpression,
  isVariableDeclarationList,
} from "typescript/unstable/ast/is";

const isNamed = (node: Node | undefined, name: string): boolean =>
  node !== undefined && isIdentifier(node) && node.text === name;

const isProcessEnv = (node: Node): boolean =>
  isPropertyAccessExpression(node) &&
  isNamed(node.expression, "process") &&
  node.name.text === "env";

const isObjectKeys = (callee: Node): boolean =>
  isPropertyAccessExpression(callee) &&
  isNamed(callee.expression, "Object") &&
  callee.name.text === "keys";

const isKeysOf = (node: Node, values: string): boolean =>
  isCallExpression(node) &&
  node.arguments.length === 1 &&
  isNamed(node.arguments[0], values) &&
  isObjectKeys(node.expression);

const isConstList = (list: Node | undefined): list is VariableDeclarationList =>
  list !== undefined && isVariableDeclarationList(list) && (list.flags & NodeFlags.Const) !== 0;

const declaresName = (list: VariableDeclarationList, name: string): boolean =>
  list.declarations.length === 1 && isNamed(list.declarations[0]?.name, name);

const declaresOnly = (loop: ForOfStatement, name: string): boolean => {
  const list = loop.initializer;
  return isConstList(list) && declaresName(list, name);
};

const loopOf = (statement: Node): ForOfStatement | undefined => {
  const loop = statement.parent;
  return loop !== undefined && isForOfStatement(loop) && loop.statement === statement
    ? loop
    : undefined;
};

const isLoopOver = (statement: Node, name: string, values: string): boolean => {
  const loop = loopOf(statement);
  return (
    loop !== undefined &&
    loop.awaitModifier === undefined &&
    declaresOnly(loop, name) &&
    isKeysOf(loop.expression, values)
  );
};

const onlyStringArgument = (node: Node): Node | undefined =>
  isCallExpression(node) && isNamed(node.expression, "String") && node.arguments.length === 1
    ? node.arguments[0]
    : undefined;

const elementOwner = (node: Node | undefined, name: string): Node | undefined =>
  node !== undefined && isElementAccessExpression(node) && isNamed(node.argumentExpression, name)
    ? node.expression
    : undefined;

const readValues = (node: Node, name: string): string | undefined => {
  const values = elementOwner(onlyStringArgument(node), name);
  return values !== undefined && isIdentifier(values) ? values.text : undefined;
};

const writtenKey = (left: Node): string | undefined =>
  isElementAccessExpression(left) &&
  isIdentifier(left.argumentExpression) &&
  isProcessEnv(left.expression)
    ? left.argumentExpression.text
    : undefined;

const statementOf = (node: Node): Node | undefined =>
  node.parent !== undefined && isExpressionStatement(node.parent) ? node.parent : undefined;

const isWriteInLoop = (node: BinaryExpression): boolean => {
  const name = writtenKey(node.left);
  if (name === undefined) return false;
  const values = readValues(node.right, name);
  const statement = statementOf(node);
  return values !== undefined && statement !== undefined && isLoopOver(statement, name, values);
};

const isSanctionedWrite = (node: Node | undefined): boolean => {
  if (node === undefined || !isBinaryExpression(node)) return false;
  return node.operatorToken.kind === SyntaxKind.EqualsToken && isWriteInLoop(node);
};

const isSanctionedArgument = (access: Node, parent: Node): boolean =>
  isCallExpression(parent) && parent.arguments[0] === access && isSanctionedWrite(parent.parent);

const isSanctionedAccess = (access: Node): boolean => {
  const { parent } = access;
  if (parent === undefined) return false;
  if (isBinaryExpression(parent)) return parent.left === access && isSanctionedWrite(parent);
  return isSanctionedArgument(access, parent);
};

const processEnvWrite = { isSanctionedAccess };

export default processEnvWrite;
