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

After deployment, update the chisel-auth secret with your chosen credential:

```bash
aws secretsmanager put-secret-value \
  --secret-id claudeui/chisel-auth \
  --secret-string 'user:YOUR_STRONG_PASSWORD' \
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

## Post-Deploy Manual Steps

Nginx config and the default backend map are deployed declaratively via UserData.
Only the mTLS certificates require manual deployment.

### 1. Deploy mTLS Certificates

Generate certificates per the PRD Section 6.1, then copy to the instance:

```bash
ELASTIC_IP=$(aws cloudformation describe-stacks \
  --stack-name claudeui-ec2 \
  --query 'Stacks[0].Outputs[?OutputKey==`PublicIP`].OutputValue' \
  --output text --region us-west-2)

scp -i claudeui-ec2-key.pem ca.crt server.crt server.key ec2-user@$ELASTIC_IP:/tmp/
ssh -i claudeui-ec2-key.pem ec2-user@$ELASTIC_IP '
  sudo cp /tmp/ca.crt /tmp/server.crt /tmp/server.key /etc/chisel/certs/
  sudo chown chisel:chisel /etc/chisel/certs/*
  sudo chmod 600 /etc/chisel/certs/server.key
  sudo systemctl start chisel-server
'
```

### 2. Deploy Backend Registry and Scripts

```bash
ssh -i claudeui-ec2-key.pem ec2-user@$ELASTIC_IP '
  sudo mkdir -p /etc/claudeui
'
# Edit and deploy backends.json with your backend configuration
# Deploy aggregator and health check scripts and systemd units
```

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
