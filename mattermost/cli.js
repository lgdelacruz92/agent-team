import { input } from "@inquirer/prompts";

const matches = (re, message) => (value) => re.test(value.trim()) || message;

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
  VPC_ID: vpcId.trim(),
  PUBLIC_SUBNET_IDS: publicSubnetIds.split(",").map((s) => s.trim()).join(","),
};

console.log("\nParameters for deploy.sh:");
console.log(params);
