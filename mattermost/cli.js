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

const publicSubnetIds = await input({
  message: "Public subnet IDs (2+ AZs, comma-separated; the instance uses the first)",
  validate: (value) => {
    const ids = value.split(",").map((s) => s.trim());
    if (ids.length < 2) return "Provide at least two subnets";
    return ids.every((id) => /^subnet-[0-9a-f]+$/.test(id)) || "Each ID should look like subnet-0abc123";
  },
});

const params = {
  AWS_PROFILE: awsProfile.trim(),
  AWS_REGION: awsRegion.trim(),
  VPC_ID: vpcId.trim(),
  PUBLIC_SUBNET_IDS: publicSubnetIds.split(",").map((s) => s.trim()).join(","),
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
