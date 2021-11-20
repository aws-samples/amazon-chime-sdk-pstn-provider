# Chime SDK Telephony Custom Resource Provider

This is an [AWS Cloud Development Kit](https://aws.amazon.com/cdk/) (CDK) [Custom Resource Provider](https://docs.aws.amazon.com/cdk/api/latest/docs/custom-resources-readme.html) (CRP)
for Chime SDK telephony resources.  Today this only supports the creation of one Phone Number, one SMA, and one SIP Rule and is suitable for being extended to support more 
complex scenarios.  We provide a cannonical example to use as a template for new Chime SDK telephony applications [here](https://github.com/aws-samples/amazon-chime-sdk-pstn-cdk).

## Usage

Clone this repo parallel to the your Chime SDK Application folder.  For example, if you were to build the [cannonical example](https://github.com/aws-samples/amazon-chime-sdk-pstn-cdk) 
you would do the following:

```bash
git clone git@github.com:aws-samples/amazon-chime-sdk-pstn-cdk.git
git clone git@github.com:aws-samples/amazon-chime-sdk-pstn-provider.git
```

You should have a folder structure that looks something like this:

```bash
├── amazon-chime-sdk-pstn-cdk
└── amazon-chime-sdk-pstn-provider
```

You do not need to edit ANYTHING in the CRP folder in order to use it.  You just need to have it present.  All configuration and interaction with the CRP will be through
the CDK script in the application folder (amazon-chime-sdk-pstn-cdk in this example).  The [application template](https://github.com/aws-samples/amazon-chime-sdk-pstn-cdk) 
folder has detailed instructions on how to build the application.

## Configuration Happens in the Sample App, Not Here

To specify the details of the phone number that the CRP will request, you do need to edit a few configuration variables in the CDK script.  I this example that 
script is at amazon-chime-sdk-pstn-cdk/lib/chime_sdk_pstn_cdk-stack.ts.  In that script near the beginning of the file you will find this:

```typescript
 // These are the configuration variables for your PhoneNumbers
    const chimeSdkVariables = {
    sipTriggerType: 'ToPhoneNumber', // https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-chime/enums/sipruletriggertype.html
    phoneNumberRequired: true,
    phoneAreaCode: '505',            // https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-chime/interfaces/searchavailablephonenumberscommandinput.html
    phoneState: '',                  // https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-chime/interfaces/searchavailablephonenumberscommandinput.html
    phoneCountry: '',                // https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-chime/interfaces/searchavailablephonenumberscommandinput.html
    phoneNumberType: 'SipMediaApplicationDialIn', // https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-chime/enums/phonenumberproducttype.html
    phoneNumberTollFreePrefix: '',   // https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-chime/interfaces/searchavailablephonenumberscommandinput.html
    }
```    

These variables are all described in detail through the [API documentation](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-chime/)
and the [API Reference](https://docs.aws.amazon.com/chime/latest/APIReference/API_Operations_Amazon_Chime.html) but here is a simplified summary of what they each do:

* sipTriggerType:  "ToPhoneNumber" | "RequestUriHostname" - only "ToPhoneNumber" is supported at this time
* phoneNumberRequired: true | false - true is required at this time

The remainder of the variables are described in detail in the 
[API guide](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-chime/interfaces/searchavailablephonenumberscommandinput.html) and are somewhat
self-explanatory.
## Using the Custom Resource Provider (CRP) in an Application

This Custom Provider is written in typescript and currently only supports the creation of one Phone Number, one SMA, and one SIP Rule.  We use a 
[Lambda Layer](https://aws.amazon.com/blogs/compute/using-lambda-layers-to-simplify-your-development-process/) to hold all the modules so that our
lambda is just the provider code.  

Below is an annotated description of how the CRP is used by an application.

```typescript
// create the lambda layer to hold routine libraries for the Custom Provider
    const providerLayer = new lambda.LayerVersion(this, 'providerLambdaLayer', {
      code: lambda.Code.fromAsset(path.join(providerLayerFolder,)),
      compatibleRuntimes: [lambda.Runtime.NODEJS_14_X],
      description: 'Provider Lambda Layer',
    });

```

Be default the providerLayerFolder is 'src/layer/' which will create a layer whose modules are available at '/opt/nodejs' in the lambda execution 
environment.

We then create an IAM role that has the needed permissions to create Chime SDK telephony resources.

```typescript
    const chimeCreateRole = new iam.Role(this, 'createChimeLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      inlinePolicies: {
        ['chimePolicy']: new iam.PolicyDocument({
          statements: [new iam.PolicyStatement({
            resources: ['*'],
            actions: ['chime:*',
              'lambda:GetPolicy',
              'lambda:AddPermission',
              'cloudformation:DescribeStacks',
              'cloudformation:DescribeStackEvents',
              'cloudformation:DescribeStackResource',
              'cloudformation:DescribeStackResources',]
          })]
        })
      },
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole")]
    });
```

We then create the CRP lambda and then create the [AWS CloudFormation](https://aws.amazon.com/cloudformation/) CRP component:

```typescript
    // create the lambda for CDK custom resource to deploy SMA, etc.
    const chimeProviderLamba = new lambda.Function(this, 'chimeSdkPstnProviderLamba-', {
      code: lambda.Code.fromAsset(chimeSdkPstnProviderDir, { exclude: ["README.md", "*.ts"] }),
      handler: ChimeSdkPstnProviderHandler,
      runtime: lambda.Runtime.NODEJS_14_X,
      role: chimeCreateRole,
      layers: [providerLayer],
      timeout: cdk.Duration.seconds(180),
    });

    // now create the custom provider
    const chimeProvider = new custom.Provider(this, 'chimeProvider', {
      onEventHandler: chimeProviderLamba,
    });

```

We now have a lambda that can respond to CDK requests for resources.  We create the CRP:

```typescript
     const inboundSMA = new cdk.CustomResource(this, 'inboundSMA', {
      serviceToken: chimeProvider.serviceToken,
      properties: chimeProviderProperties,
    });
```

The CDK framework will now manage the Chime SDK telephony resources through the stack construct, just as it does all other AWS 
resources.

## The Actual Custom Resource Provider (CRP) Code

The code for the CRP is in 'index.ts' and is transpiled to javascript during the CDK build process.

## Disclaimer

Deploying the Amazon Chime SDK demo application contained in this repository will cause your AWS Account to be billed for services used by the application.

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This code is licensed under the MIT-0 License. See the LICENSE file.

