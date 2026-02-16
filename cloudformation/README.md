# CloudFormation Stacks — Claude Code UI EC2 Deployment

Infrastructure as Code for the Claude Code UI EC2 + Chisel tunnel deployment.
TLS is handled by ALB + ACM (auto-renewing). Nginx runs HTTP-only behind the ALB.

## Prerequisites

- AWS CLI v2 configured with appropriate credentials (`aws configure`)
- A Route53 hosted zone for your domain (e.g., `superlinear.com`)

The EC2 key pair and AMI are managed declaratively by the stack — no manual lookup required.

## Stacks

| # | Template | Stack Name | Resources |
|---|----------|------------|-----------|
| 1 | `01-network.yaml` | `claudeui-network` | VPC, subnets (2 AZs), IGW, routes |
| 2 | `02-secrets.yaml` | `claudeui-secrets` | Secrets Manager entries |
| 3 | `03-ec2.yaml` | `claudeui-ec2` | EC2, EIP, SGs, IAM, ALB, ACM cert, target group, listeners, Route53 records |

## Deploy Order

Stacks must be deployed in order — each depends on outputs from the previous.

### 1. Network (VPC, Subnets, IGW)

```bash
aws cloudformation deploy \
  --template-file 01-network.yaml \
  --stack-name claudeui-network \
  --region us-west-2
```

### 2. Secrets Manager

```bash
aws cloudformation deploy \
  --template-file 02-secrets.yaml \
  --stack-name claudeui-secrets \
  --region us-west-2
```

After deployment, provision secrets. The EC2 instance (stack 3) pulls these at boot time.

**Chisel auth credential:**

```bash
aws secretsmanager put-secret-value \
  --secret-id claudeui/chisel-auth \
  --secret-string 'user:YOUR_STRONG_PASSWORD' \
  --region us-west-2
```

**mTLS certificates** (generate per PRD Section 6.1, then store PEM content):

```bash
aws secretsmanager put-secret-value \
  --secret-id claudeui/mtls-ca-cert \
  --secret-string file://ca.crt \
  --region us-west-2

aws secretsmanager put-secret-value \
  --secret-id claudeui/mtls-server-cert \
  --secret-string file://server.crt \
  --region us-west-2

aws secretsmanager put-secret-value \
  --secret-id claudeui/mtls-server-key \
  --secret-string file://server.key \
  --region us-west-2
```

**GitHub deploy key** (for cloning and building the frontend on the instance):

```bash
# 1. Generate a deploy key
ssh-keygen -t ed25519 -f claudeui-deploy-key -N "" -C "claudeui-ec2-deploy"

# 2. Add the PUBLIC key to GitHub repo → Settings → Deploy keys (read-only)
cat claudeui-deploy-key.pub

# 3. Store the PRIVATE key in Secrets Manager
aws secretsmanager put-secret-value \
  --secret-id claudeui/github-deploy-key \
  --secret-string file://claudeui-deploy-key \
  --region us-west-2

# 4. Delete local copy
rm -f claudeui-deploy-key claudeui-deploy-key.pub
```

**Note:** The CA private key (`claudeui-ca/mtls-ca-key`) is stored under a separate prefix
and is NOT accessible to the EC2 instance. Store it manually if needed for future cert generation:

```bash
aws secretsmanager put-secret-value \
  --secret-id claudeui-ca/mtls-ca-key \
  --secret-string file://ca.key \
  --region us-west-2
```

### 3. EC2 Instance + ALB + ACM + DNS

Get the VPC, Subnet, and Hosted Zone IDs:

```bash
VPC_ID=$(aws cloudformation describe-stacks \
  --stack-name claudeui-network \
  --query 'Stacks[0].Outputs[?OutputKey==`VpcId`].OutputValue' \
  --output text --region us-west-2)

SUBNET_A_ID=$(aws cloudformation describe-stacks \
  --stack-name claudeui-network \
  --query 'Stacks[0].Outputs[?OutputKey==`SubnetAId`].OutputValue' \
  --output text --region us-west-2)

SUBNET_B_ID=$(aws cloudformation describe-stacks \
  --stack-name claudeui-network \
  --query 'Stacks[0].Outputs[?OutputKey==`SubnetBId`].OutputValue' \
  --output text --region us-west-2)

HOSTED_ZONE_ID=$(aws route53 list-hosted-zones-by-name \
  --dns-name superlinear.com \
  --query 'HostedZones[0].Id' \
  --output text --region us-west-2 | sed 's|/hostedzone/||')

aws cloudformation deploy \
  --template-file 03-ec2.yaml \
  --stack-name claudeui-ec2 \
  --region us-west-2 \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    VpcId="$VPC_ID" \
    SubnetId="$SUBNET_A_ID" \
    SubnetBId="$SUBNET_B_ID" \
    HostedZoneId="$HOSTED_ZONE_ID" \
    AdminCidr="YOUR_IP/32"
```

**Note:** ACM certificate validation happens automatically via DNS. CloudFormation
will wait for the certificate to be issued before creating the HTTPS listener. This
typically completes within a few minutes.

After deployment, retrieve the SSH private key from SSM Parameter Store:

```bash
KEY_PAIR_ID=$(aws cloudformation describe-stacks \
  --stack-name claudeui-ec2 \
  --query 'Stacks[0].Outputs[?OutputKey==`KeyPairId`].OutputValue' \
  --output text --region us-west-2)

aws ssm get-parameter \
  --name "/ec2/keypair/$KEY_PAIR_ID" \
  --with-decryption \
  --query Parameter.Value \
  --output text --region us-west-2 > claudeui-ec2-key.pem

chmod 600 claudeui-ec2-key.pem
```

## What UserData Does

Everything is deployed declaratively at instance boot via UserData. No SSH or SCP needed.

| Component | Source | Behavior if secret missing |
|-----------|--------|---------------------------|
| Chisel auth | `claudeui/chisel-auth` | **Fatal** — UserData fails |
| mTLS certs | `claudeui/mtls-ca-cert`, `mtls-server-cert`, `mtls-server-key` | Chisel enabled but not started; logs warning |
| Frontend | `claudeui/github-deploy-key` + git clone + build | Placeholder page served; logs warning |
| Nginx config | Embedded in UserData | Always deployed |
| Backend registry | Embedded in UserData | Default: single backend on port 9001 |
| Tunnel health check | Embedded in UserData | Timer runs every 30s |

To get a fully functional instance, provision all secrets (Section 2 above) **before** deploying stack 3.

## Verification

After deployment, verify the setup:

```bash
# DNS: agents.superlinear.com → ALB (CNAME/alias)
dig agents.superlinear.com

# DNS: tunnel.agents.superlinear.com → EIP
dig tunnel.agents.superlinear.com

# HTTPS via ALB (ACM cert)
curl -I https://agents.superlinear.com

# HTTP redirects to HTTPS (ALB listener rule)
curl -I http://agents.superlinear.com
```

## Stack Deletion (Reverse Order)

Delete stacks in reverse order to avoid dependency errors:

```bash
aws cloudformation delete-stack --stack-name claudeui-ec2 --region us-west-2
aws cloudformation wait stack-delete-complete --stack-name claudeui-ec2 --region us-west-2

aws cloudformation delete-stack --stack-name claudeui-secrets --region us-west-2
aws cloudformation wait stack-delete-complete --stack-name claudeui-secrets --region us-west-2

aws cloudformation delete-stack --stack-name claudeui-network --region us-west-2
aws cloudformation wait stack-delete-complete --stack-name claudeui-network --region us-west-2
```

**Note:** Secrets Manager secrets have a 7-day recovery window by default. To delete immediately, use `--force-delete-without-recovery` on the secrets stack or delete secrets individually first.
