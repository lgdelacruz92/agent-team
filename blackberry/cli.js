import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { confirm, input } from "@inquirer/prompts";

const matches = (re, message) => (value) => re.test(value.trim()) || message;

const awsProfile = await input({
  message: "AWS profile",
  default: process.env.AWS_PROFILE || "default",
  validate: (value) => value.trim() !== "" || "Required",
});

const awsRegion = await input({
  message: "AWS region",
  default: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || undefined,
  validate: matches(/^[a-z]{2}(-[a-z]+)+-\d$/, "Expected something like us-east-1"),
});

const vpcId = await input({
  message: "VPC ID",
  validate: matches(/^vpc-[0-9a-f]+$/, "Expected something like vpc-0abc123"),
});

const subnetId = await input({
  message: "Public subnet ID for the instance (an existing stack's instance is replaced if this changes)",
  validate: matches(/^subnet-[0-9a-f]+$/, "Expected something like subnet-0abc123"),
});

const params = {
  AWS_PROFILE: awsProfile.trim(),
  AWS_REGION: awsRegion.trim(),
  VPC_ID: vpcId.trim(),
  SUBNET_ID: subnetId.trim(),
};

console.log("\nParameters for deploy.sh:");
console.log(params);

if (!(await confirm({ message: "Deploy the stack with these parameters?", default: false }))) {
  console.log("Cancelled.");
  process.exit(0);
}

const script = join(dirname(fileURLToPath(import.meta.url)), "deploy.sh");
const child = spawn("bash", [script], { stdio: "inherit", env: { ...process.env, ...params } });
child.on("error", (err) => {
  console.error(`Failed to run deploy.sh: ${err.message}`);
  process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 1));
