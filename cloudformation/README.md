# CloudFormation Stacks — Claude Code UI EC2 Deployment

Infrastructure as Code for the Claude Code UI EC2 + Chisel tunnel deployment.

## Prerequisites

- AWS CLI v2 configured with appropriate credentials (`aws configure`)
- A Route53 hosted zone for your domain (e.g., `superlinear.com`)

The EC2 key pair and AMI are managed declaratively by the stack — no manual lookup required.

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

### 3. EC2 Instance

Get the VPC and Subnet IDs from the network stack outputs:

```bash
VPC_ID=$(aws cloudformation describe-stacks \
  --stack-name claudeui-network \
  --query 'Stacks[0].Outputs[?OutputKey==`VpcId`].OutputValue' \
  --output text --region us-west-2)

SUBNET_ID=$(aws cloudformation describe-stacks \
  --stack-name claudeui-network \
  --query 'Stacks[0].Outputs[?OutputKey==`SubnetAId`].OutputValue' \
  --output text --region us-west-2)

aws cloudformation deploy \
  --template-file 03-ec2.yaml \
  --stack-name claudeui-ec2 \
  --region us-west-2 \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    VpcId="$VPC_ID" \
    SubnetId="$SUBNET_ID" \
    AdminCidr="YOUR_IP/32"
```

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

### 4. Route53 DNS

Get the Elastic IP and Hosted Zone ID:

```bash
ELASTIC_IP=$(aws cloudformation describe-stacks \
  --stack-name claudeui-ec2 \
  --query 'Stacks[0].Outputs[?OutputKey==`PublicIP`].OutputValue' \
  --output text --region us-west-2)

HOSTED_ZONE_ID=$(aws route53 list-hosted-zones-by-name \
  --dns-name superlinear.com \
  --query 'HostedZones[0].Id' \
  --output text --region us-west-2 | sed 's|/hostedzone/||')

aws cloudformation deploy \
  --template-file 04-route53.yaml \
  --stack-name claudeui-dns \
  --region us-west-2 \
  --parameter-overrides \
    HostedZoneId="$HOSTED_ZONE_ID" \
    ElasticIP="$ELASTIC_IP"
```

## Post-Deploy Manual Steps

These steps require SSH access to the EC2 instance.

### 1. Deploy mTLS Certificates

Generate certificates per the PRD Section 6.1, then copy to the instance:

```bash
scp -i claudeui-ec2-key.pem ca.crt server.crt server.key ec2-user@$ELASTIC_IP:/tmp/
ssh -i claudeui-ec2-key.pem ec2-user@$ELASTIC_IP '
  sudo cp /tmp/ca.crt /tmp/server.crt /tmp/server.key /etc/chisel/certs/
  sudo chown chisel:chisel /etc/chisel/certs/*
  sudo chmod 600 /etc/chisel/certs/server.key
  sudo systemctl start chisel-server
'
```

### 2. Set Up Let's Encrypt (certbot)

```bash
ssh -i claudeui-ec2-key.pem ec2-user@$ELASTIC_IP '
  sudo certbot --nginx -d agents.superlinear.com
'
```

### 3. Deploy Nginx Configuration

```bash
scp -i claudeui-ec2-key.pem deploy/ec2/nginx/claudeui.conf ec2-user@$ELASTIC_IP:/tmp/
scp -i claudeui-ec2-key.pem deploy/ec2/nginx/claudeui-backends.conf ec2-user@$ELASTIC_IP:/tmp/
ssh -i claudeui-ec2-key.pem ec2-user@$ELASTIC_IP '
  sudo cp /tmp/claudeui.conf /etc/nginx/conf.d/
  sudo cp /tmp/claudeui-backends.conf /etc/nginx/conf.d/
  sudo nginx -t && sudo systemctl reload nginx
'
```

### 4. Deploy Backend Registry and Scripts

```bash
ssh -i claudeui-ec2-key.pem ec2-user@$ELASTIC_IP '
  sudo mkdir -p /etc/claudeui
'
# Edit and deploy backends.json with your backend configuration
# Deploy aggregator and health check scripts and systemd units
```

## Stack Deletion (Reverse Order)

Delete stacks in reverse order to avoid dependency errors:

```bash
aws cloudformation delete-stack --stack-name claudeui-dns --region us-west-2
aws cloudformation wait stack-delete-complete --stack-name claudeui-dns --region us-west-2

aws cloudformation delete-stack --stack-name claudeui-ec2 --region us-west-2
aws cloudformation wait stack-delete-complete --stack-name claudeui-ec2 --region us-west-2

aws cloudformation delete-stack --stack-name claudeui-secrets --region us-west-2
aws cloudformation wait stack-delete-complete --stack-name claudeui-secrets --region us-west-2

aws cloudformation delete-stack --stack-name claudeui-network --region us-west-2
aws cloudformation wait stack-delete-complete --stack-name claudeui-network --region us-west-2
```

**Note:** Secrets Manager secrets have a 7-day recovery window by default. To delete immediately, use `--force-delete-without-recovery` on the secrets stack or delete secrets individually first.
