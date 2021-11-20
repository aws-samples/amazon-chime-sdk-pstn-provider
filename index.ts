/*
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: MIT-0
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of this
 * software and associated documentation files (the "Software"), to deal in the Software
 * without restriction, including without limitation the rights to use, copy, modify,
 * merge, publish, distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 * INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
 * PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 * HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
 * SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

import { CloudFormationCustomResourceEvent, CloudFormationCustomResourceResponse, Context } from "aws-lambda";
import { ChimeClient, CreatePhoneNumberOrderCommand, CreatePhoneNumberOrderCommandInput, CreatePhoneNumberOrderCommandOutput, CreateSipMediaApplicationCallCommand, CreateSipMediaApplicationCallCommandInput, CreateSipMediaApplicationCallCommandOutput, CreateSipMediaApplicationCommand, CreateSipMediaApplicationCommandInput, CreateSipRuleCommand, CreateSipRuleCommandInput, DeletePhoneNumberCommand, DeletePhoneNumberCommandInput, DeleteSipMediaApplicationCommand, DeleteSipMediaApplicationCommandInput, DeleteSipRuleCommand, DeleteSipRuleCommandInput, GetPhoneNumberCommand, GetRetentionSettingsCommand, GetSipMediaApplicationCommand, ListPhoneNumberOrdersCommand, ListPhoneNumberOrdersCommandInput, ListPhoneNumberOrdersCommandOutput, ListPhoneNumbersCommand, ListPhoneNumbersCommandInput, ListPhoneNumbersResponse, ListSipRulesCommand, ListSipRulesCommandInput, PhoneNumber, RegistrationStatus, ResetPersonalPINResponse, SearchAvailablePhoneNumbersCommand, SearchAvailablePhoneNumbersCommandInput, SipMediaApplication, SipMediaApplicationEndpoint, SipRuleTargetApplication, UntagAttendeeRequest, UpdateSipRuleCommand, UpdateSipRuleCommandInput } from "@aws-sdk/client-chime";
import { Endpoint, Nimble, ResourceGroups } from "aws-sdk";
import { ListPhoneNumberOrdersRequest, ListPhoneNumberOrdersResponse, SipMediaApplicationEndpointList } from "aws-sdk/clients/chime";
import { LambdaARN } from "aws-sdk/clients/lexmodelbuildingservice";
import { StringForNextToken } from "aws-sdk/clients/s3control";
import { bool } from "aws-sdk/clients/signer";
import { CloudFormationClient, CloudFormationClientConfig, DescribeStackInstanceCommand, DescribeStacksCommand, DescribeStacksCommandInput, ListStackInstancesCommand, ListStackInstancesCommandInput, ListStacksCommand, ListStacksCommandInput, ListStackSetsCommand, ListStackSetsCommandInput } from "@aws-sdk/client-cloudformation";
import { DescribeStackInstanceInput } from "aws-sdk/clients/cloudformation";
import { Stack } from "aws-sdk/clients/appstream";
import { CloudFormationStackRecord, CreateCloudFormationStackResult } from "aws-sdk/clients/lightsail";

interface phoneFilterParams extends SearchAvailablePhoneNumbersCommandInput { };

interface outputObject {
    OutputKey: string,
    OutputValue: string,
    ExportName: string,
}

interface resourceVars {
    client?: ChimeClient,
    cfclient?: CloudFormationClient,
    region: string,
    stackName?: string,
    stackID?: string,
    smaName: string,
    sipRuleName: string,
    lambdaArn: string,
    sipTriggerType: string,
    phoneType: string,     // https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-chime/enums/phonenumberproducttype.html
    phoneID?: string,
    phoneNum?: string,
    phoneNumberOrderID?: string,
    phoneNumReady?: bool,
    smaID?: string,
    sipRuleID?: string,
    phoneFilter?: phoneFilterParams,
    orderToken: string,
    cfStackOutputs?: outputObject[],
}


async function getResources(resources: resourceVars) {
    if (resources == undefined) { return false };

    var num, pn, sma, siprule;

    try {
        num = await findPhoneNumber(resources);
    } catch (error) {
        console.log(error);
    }

    try {
        pn = await getPhoneNumber(resources);
    } catch (error) {
        console.log("********************* getPhoneNumber ERROR ********************");
        console.log(error);
        return;
    }


    try {
        sma = await getSMA(resources);
    } catch (error) {
        console.log("********************* getSMA ERROR ********************");
        console.log(error);
        return;
    }

    try {
        siprule = await getSipRule(resources);
    } catch (error) {
        console.log("********************* getSMA ERROR ********************");
        console.log(error);
        return;
    }
    return true;

};


async function findPhoneNumber(resources: resourceVars) {
    if (resources == undefined) { return false };
    if (resources.client == undefined) { return false };
    if (resources.phoneFilter == undefined) { return false };

    // https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-chime/interfaces/searchavailablephonenumberscommandinput.html
    try {
        const command = new SearchAvailablePhoneNumbersCommand(resources.phoneFilter);
        const response = await resources.client.send(command);
        if (response && response.E164PhoneNumbers && response.E164PhoneNumbers?.length > 0) {
            resources.phoneNum = response.E164PhoneNumbers[0];
            console.log("available phone number: ", resources.phoneNum);
            return true;
        }
    } catch (error) {
        console.log(error);
    }
    return false;
}

async function getPhoneNumber(resources: resourceVars) {
    if (resources == undefined) { return false };
    if (resources.client == undefined) { return false };
    if (resources.phoneNum == undefined) { return false };

    //    https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-chime/interfaces/createphonenumberordercommandinput.html
    try {
        const phonenums: string[] = new Array();
        phonenums[0] = resources.phoneNum;
        const params: CreatePhoneNumberOrderCommandInput = {
            E164PhoneNumbers: phonenums,
            ProductType: resources.phoneType,
        }
        const command = new CreatePhoneNumberOrderCommand(params);
        const response = await resources.client.send(command);
        resources.phoneNumberOrderID = response.PhoneNumberOrder?.PhoneNumberOrderId;
        console.log("PhoneNumberOrderId: ", response.PhoneNumberOrder?.PhoneNumberOrderId);
    } catch (error) {
        console.log("********************* CreatePhoneNumberOrderCommand ERROR ********************");
        console.log(error);
    }

    var retries: number = 12;
    var count: number = 0;
    var sleepdur: number = 5000; // milliseconds
    var ready: bool = false;

    while (true) {
        try {
            const ready = await checkPhoneNumberOrder(resources);
            if (ready) { break; };
            if (resources.orderToken) {
                console.log("********************************** more numbers available, token: ", resources.orderToken);
                continue;
            };
            //console.log("waiting for ", resources.phoneNum, " to be ready...");
            await new Promise(resolve => setTimeout(resolve, sleepdur));
        } catch (error) {
            console.log("********************* checkPhoneNumber ERROR ********************");
            console.log(error);
            return;
        }
    }
    console.log("looking for phoneID...");
    while (true) {
        try {
            const ready = await findPhoneNumberID(resources);
            if (ready) { break; };
            if (resources.orderToken) {
                console.log("********************************** more phoneIDs available, token: ", resources.orderToken);
                continue;
            };
        } catch (error) {
            console.log("********************* checkPhoneNumber ERROR ********************");
            console.log(error);
            return;
        }
    }
    if (resources.phoneID) {
        console.log("found phoneID: ", resources.phoneID);
        return true;
    }
    return false;
}


async function findPhoneNumberID(resources: resourceVars) {
    if (!resources.client) { return false };
    try {
        const params: ListPhoneNumbersCommandInput = {
            MaxResults: 99,
            NextToken: '',
            ProductType: resources.phoneType,
            Status: 'Unassigned',
        }
        console.log(params);
        const command = new ListPhoneNumbersCommand(params);
        const response = await resources.client.send(command);
        console.log("list (", response.PhoneNumbers?.length, "): ", JSON.stringify(response.PhoneNumbers));
        if (response && response.PhoneNumbers) {
            for (let num of response.PhoneNumbers) {
                console.log("number: ", num.E164PhoneNumber, " status: ", num.Status, "looking for: ", resources.phoneNum);
                if (num.E164PhoneNumber == resources.phoneNum) {
                    resources.phoneID = num.PhoneNumberId;
                    console.log("Setting phoneID: ", resources.phoneID);
                    return true;
                }
            }
        } else {
            console.log("no phone numbers returned from ListPhoneNumbersCommand");
        }
    } catch (error) {
        console.log("********************* ListPhoneNumbers ERROR ********************");
        console.log(error);
    }
    return false;
}


async function checkPhoneNumberOrder(resources: resourceVars) {
    // returns true if the earlier issued PhoneNumberOrder is now "Successful"
    if (resources == undefined) { return false };
    if (resources.client == undefined) { return false };

    try {
        const params: ListPhoneNumberOrdersCommandInput = {
            MaxResults: 99,
            NextToken: '',
        }

        if (resources.orderToken) {
            params.NextToken = resources.orderToken;
        }
        var command = new ListPhoneNumberOrdersCommand(params);
        var response = await resources.client.send(command);
        if (response && response.PhoneNumberOrders) {
            console.log("total orders found: ", response.PhoneNumberOrders.length);
            if (response.NextToken) {
                resources.orderToken = response.NextToken
                console.log("nextToken: ", response.NextToken);
            } else {
                resources.orderToken = '';
            }
            for (let num of response.PhoneNumberOrders) {
                console.log("checking orderID (", num.Status, "): ", num.PhoneNumberOrderId, " looking for ", resources.phoneNumberOrderID);
                if (num.PhoneNumberOrderId == resources.phoneNumberOrderID) {
                    var nospaces = num.Status?.replace(/ /g, '');
                    if (nospaces == "Successful") {
                        resources.phoneNumReady = true;
                        console.log("phone order is successful")
                        return true;
                    }
                }
            }
            return false;
        }
    } catch (error) {
        console.log("********************* ListPhoneNumbersCommand ERROR ********************");
        console.log(error);
    }
    return false;
};


async function getSMA(resources: resourceVars) {
    if (resources == undefined) { return false };
    if (resources.client == undefined) { return false };

    //    https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-chime/interfaces/createsipmediaapplicationcommandinput.html
    const ep: SipMediaApplicationEndpoint = {
        LambdaArn: resources.lambdaArn,
    }
    const eps: SipMediaApplicationEndpointList = [ep];
    const params = {
        //       name: resources.smaName,
        Name: resources.smaName,
        AwsRegion: resources.region,
        Endpoints: eps,
    }
    try {
        const command = new CreateSipMediaApplicationCommand(params);
        const response = await resources.client.send(command);
        if (response && response.SipMediaApplication && response.SipMediaApplication.SipMediaApplicationId) {
            resources.smaID = response.SipMediaApplication?.SipMediaApplicationId;
        } else { resources.smaID = "error in response from CreateSipMediaApplicationCommand" }
        return true;
    } catch (err) {
        console.log(err);
    }
    return false;
}

async function getSipRule(resources: resourceVars) {
    if (resources == undefined) { return false };
    if (resources.client == undefined) { return false };

    const ta: SipRuleTargetApplication = {
        AwsRegion: resources.region,
        Priority: 1,
        SipMediaApplicationId: resources.smaID,
    };
    const params: CreateSipRuleCommandInput = {
        Name: resources.sipRuleName,
        TargetApplications: [
            ta,
        ],
        TriggerType: resources.sipTriggerType,
        TriggerValue: resources.phoneNum,
        Disabled: false,
    }

    try {
        const command = new CreateSipRuleCommand(params);
        const response = await resources.client.send(command);
        resources.sipRuleID = response.SipRule?.SipRuleId;
        return true;
    } catch (error) {
        console.log(error);
    }
    return false;
}

async function deleteResources(resources: resourceVars) {
    if (resources == undefined) { return false };
    if (resources.client == undefined) { return false };

    try {
        console.log("about to disable sipRuleID: ", resources.sipRuleID);
        const disable = await disableSipRule(resources);
    } catch (error) {
        console.log(error);
    }
    try {
        console.log("about to delete sipRuleID: ", resources.sipRuleID);
        const delsiprule = await deleteSipRule(resources);
    } catch (error) {
        console.log(error);
    }
    try {
        console.log("about to delete smaID: ", resources.smaID);
        const delsma = await deleteSMA(resources);
    } catch (error) {
        console.log(error);
    }
    try {
        console.log("about to delete phoneID: ", resources.phoneID);
        const delphone = await deletePhone(resources);
        console.log(delphone);
    } catch (error) {
        console.log(error);
    }
    return true;
}

async function deleteSMA(resources: resourceVars) {
    if (resources == undefined) { return false };
    if (resources.client == undefined) { return false };
    if (resources.smaID == undefined) { return false };

    // https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-chime/interfaces/deletesipmediaapplicationcommandinput.html
    const params: DeleteSipMediaApplicationCommandInput = {
        SipMediaApplicationId: resources.smaID,
    }
    try {
        const command = new DeleteSipMediaApplicationCommand(params);
        const response = await resources.client.send(command);
        console.log("SMA deleted:", resources.smaID);
        return true;
    } catch (error) {
        console.log(error);
    }
    return false;
}

async function disableSipRule(resources: resourceVars) {
    if (resources == undefined) { return false };
    if (resources.client == undefined) { return false };
    if (resources.sipRuleID == undefined) { return false };

    const params: UpdateSipRuleCommandInput = {
        SipRuleId: resources.sipRuleID,
        Disabled: true,
        Name: resources.smaName,
    }
    var response;
    try {
        console.log("disabling rule: ", params.SipRuleId)
        const command = new UpdateSipRuleCommand(params);
        response = await resources.client.send(command);
        return true;
    } catch (error) {
        console.log(error);
    }
    return response;
}


async function deleteSipRule(resources: resourceVars) {
    if (resources == undefined) { return false };
    if (resources.client == undefined) { return false };
    if (resources.sipRuleID == undefined) { return false };

    const params: DeleteSipRuleCommandInput = {
        SipRuleId: resources.sipRuleID,
    }
    try {
        const command = new DeleteSipRuleCommand(params);
        const response = await resources.client.send(command);
        return true;
    } catch (error) {
        console.log(error);
    }
    return false;
}

async function deletePhone(resources: resourceVars) {
    if (resources == undefined) { return false };
    if (resources.client == undefined) { return false };
    if (resources.phoneID == undefined) { return false };

    // for some reason inserting a 5 second delay here makes it work - I suspect that deleting the phone right after
    // deleting the SIP rule triggers some bug and the underlying SDK fails on the delete request
    // I don't think it's an unresolved promise - the errors are "bad service request"
    var sleepdur: number = 5000; // milliseconds
    try {
        await new Promise(resolve => setTimeout(resolve, sleepdur));
    } catch (error) {
        console.log(error);
        return false;
    }
    console.log("deleting phoneID: ", resources.phoneID);

    // https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-chime/interfaces/deletephonenumbercommandinput.html
    const params: DeletePhoneNumberCommandInput = {
        PhoneNumberId: resources.phoneID,
    }
    console.log(params);
    try {
        const command = new DeletePhoneNumberCommand(params);
        const response = await resources.client.send(command);
        console.log("phone deleted:", resources.phoneID);
        return true;
    } catch (error) {
        console.log(error);
    }
    return false;
}

function populateFilterParams(phoneFilter: phoneFilterParams, event: CloudFormationCustomResourceEvent) {
    if (event.ResourceProperties.phoneAreaCode) { phoneFilter.AreaCode = event.ResourceProperties.phoneAreaCode };
    if (event.ResourceProperties.phoneState) {
        phoneFilter.State = event.ResourceProperties.phoneState;
    }
    if (event.ResourceProperties.phoneCountry) {
        phoneFilter.Country = event.ResourceProperties.phoneCountry;
    }
    if (event.ResourceProperties.phoneNumberTollFreePrefix) {
        phoneFilter.TollFreePrefix = event.ResourceProperties.phoneNumberTollFreePrefix
    }
}

async function findChimeResources(resources: resourceVars) {
    var ready = false;
    while (true) {
        try {
            await new Promise(resolve => setTimeout(resolve, 250)); // avoid exceeding rate limits if hard to find stack
        } catch (error) {
            console.log(error);
            return false;
        }
        console.log("calling findChimeStack");
        try {
            ready = await findChimeStack(resources);
            if (ready) {
                console.log("Stackname: ", resources.stackName);
                if (resources.cfStackOutputs) {
                    resources.cfStackOutputs.forEach(obj => {
                        console.log(obj);
                        if (obj.OutputKey == 'sipRuleID') { resources.sipRuleID = obj.OutputValue };
                        if (obj.OutputKey == 'smaID') { resources.smaID = obj.OutputValue };
                        if (obj.OutputKey == 'phoneID') { resources.phoneID = obj.OutputValue };
                    })
                    console.log("phoneID:   ", resources.phoneID);
                    console.log("sipRuleID: ", resources.sipRuleID);
                    console.log("smaID:     ", resources.smaID);
                    return true;
                } else {
                    return false;
                }
            };
            if (resources.orderToken) {
                console.log("********************************** more stacks available, token: ", resources.orderToken);
                continue;
            };
        } catch (error) {
            console.log("********************* findChimeStack ERROR ********************");
            console.log(error);
            return false;
        }
    }
    return false;
}

async function findChimeStack(resources: resourceVars) {

    if (resources == undefined || resources.stackID == undefined || resources.cfclient == undefined) {
        return false;
    };
    console.log("findChimeStack: ", resources.stackID);
    console.log("resources: ", resources);
    let params: DescribeStacksCommandInput = {};
    params.StackName = resources.stackID;
    if (resources.orderToken) {
        params.NextToken = resources.orderToken;
    }
    console.log("params: ", params);
    try {
        const command = new DescribeStacksCommand(params);
        const response = await resources.cfclient.send(command);
        if (response.NextToken) {
            resources.orderToken = response.NextToken
        } else {
            resources.orderToken = '';
        }
        console.log("response.Stacks: ", JSON.stringify(response.Stacks));
        if (response && response.Stacks) {
            for (let s of response.Stacks) {
                console.log("stack: ", s.StackName, " - id: ", s.StackId, " has: ", JSON.stringify(s.Outputs));
                if (resources.stackID == s.StackId) {
                    resources.stackID = s.StackId;
                    console.log("s.Outputs: ", s.Outputs);
                    if (s.Outputs) {
                        resources.cfStackOutputs = s.Outputs as outputObject[];
                        return true;
                    } else {
                        console.log("ERROR: Stack has no outputs");
                        return false;
                    }
                }
            }
            console.log("ERROR: No matching stack found");
            return false;
        }
    } catch (error) {
        console.log("********************* ListStackSetsCommand ERROR ********************");
        console.log(error);
    }
    console.log("cannot find chime stack at this time");
    return false;
}


exports.handler = async function (event: CloudFormationCustomResourceEvent, context: Context) {

    console.log("event: ", JSON.stringify(event));
    console.log("context: ", JSON.stringify(context));
    console.log('## ENVIRONMENT VARIABLES: ', JSON.stringify(process.env));
    console.log("A");

    var phoneFilter: phoneFilterParams = {};
    populateFilterParams(phoneFilter, event);
    console.log("phoneFilter: ", phoneFilter);

    var resources: resourceVars = {
        region: event.ResourceProperties.region,
        smaName: event.ResourceProperties.smaName,
        sipRuleName: event.ResourceProperties.sipRuleName,
        lambdaArn: event.ResourceProperties.lambdaArn,
        phoneType: event.ResourceProperties.phoneNumberType,
        sipTriggerType: event.ResourceProperties.sipTriggerType,
        phoneFilter: phoneFilter,
        orderToken: '',
    }

    resources.client = new ChimeClient({ region: resources.region, });
    resources.cfclient = new CloudFormationClient({ region: resources.region });
    var retdata = {
        smaID: "none",
        sipRuleID: "none",
        phoneID: "none",
        phoneNumber: "none",
    }
    var pid = "ChimeSDKProvider";
    switch (event.RequestType) {
        case "Create":
            console.log("CREATE");
            const res = await getResources(resources);
            console.log("res: ", JSON.stringify(res));
            console.log("resouces: ", JSON.stringify(resources));
            try {
                console.log("pid: ", pid);
                if (resources.smaName) { retdata.smaID = resources.smaID as string; };
                if (resources.sipRuleID) { retdata.sipRuleID = resources.sipRuleID as string; };
                if (resources.phoneNum) { retdata.phoneNumber = resources.phoneNum as string; };
                if (resources.phoneID) { retdata.phoneID = resources.phoneID as string; };
                console.log("Resources deployed - returning: ", JSON.stringify(retdata));
                const response: CloudFormationCustomResourceResponse = {
                    Status: "SUCCESS",
                    Reason: "",
                    LogicalResourceId: event.LogicalResourceId,
                    PhysicalResourceId: pid,
                    RequestId: event.RequestId,
                    StackId: event.StackId,
                    Data: retdata,
                };
                return response;
            } catch (error) {
                console.log(error);
                console.log("pid: ", pid);
                const response: CloudFormationCustomResourceResponse = {
                    Status: "FAILED",
                    Reason: "Custom resource failed on creation",
                    LogicalResourceId: event.LogicalResourceId,
                    PhysicalResourceId: pid,
                    RequestId: event.RequestId,
                    StackId: event.StackId,
                    Data: retdata,
                };
                return response;
            }
        case "Delete":
            resources.stackName = '';
            const client = new CloudFormationClient({});
            resources.stackID = event.StackId;
            const found = await findChimeResources(resources);
            try {
                console.log("(", found, ") resources: ", resources);
                if (found) {
                    const del = await deleteResources(resources);
                    try {
                        console.log("resources deleted");
                        const response: CloudFormationCustomResourceResponse = {
                            Status: "SUCCESS",
                            Reason: "",
                            LogicalResourceId: event.LogicalResourceId,
                            PhysicalResourceId: event.PhysicalResourceId,
                            RequestId: event.RequestId,
                            StackId: event.StackId,
                        };
                        return response;
                    } catch (error) {
                        console.log(error);
                        const response: CloudFormationCustomResourceResponse = {
                            Status: "FAILED",
                            Reason: "Custom resource failed on deletion",
                            LogicalResourceId: event.LogicalResourceId,
                            PhysicalResourceId: event.PhysicalResourceId,
                            RequestId: event.RequestId,
                            StackId: event.StackId,
                            Data: retdata,
                        };
                        return response;
                    }
                } // need to return error when not found
                else {
                    const response: CloudFormationCustomResourceResponse = {
                        Status: "FAILED",
                        Reason: "Stack name not found",
                        LogicalResourceId: event.LogicalResourceId,
                        PhysicalResourceId: event.PhysicalResourceId,
                        RequestId: event.RequestId,
                        StackId: event.StackId,
                        Data: retdata,
                    };
                    return response;
                }

            } catch {

            }
        case "Update":
            console.log("update");
            const response = {
                Status: "FAILED",
                Reason: "Custom resource update not yet supported",
                LogicalResourceId: event.LogicalResourceId,
                PhysicalResourceId: event.PhysicalResourceId,
                RequestId: event.RequestId,
                StackId: event.StackId,
                Data: {},
            };
            return response;
    }

}

