/**
 * Copyright 2016 IBM All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

// This is an end-to-end test that focuses on exercising all parts of the fabric APIs
// in a happy-path scenario
'use strict';

if (global && global.hfc) global.hfc.config = undefined;
require('nconf').reset();
var utils = require('fabric-client/lib/utils.js');
utils.setConfigSetting('hfc-logging', '{"debug":"console"}');
var logger = utils.getLogger('install');

var tape = require('tape');
var _test = require('tape-promise');
var test = _test(tape);

var path = require('path');
var fs = require('fs');
var util = require('util');

var hfc = require('fabric-client');
var Peer = require('fabric-client/lib/Peer.js');
var Orderer = require('fabric-client/lib/Orderer.js');
var Packager = require('fabric-client/lib/Packager.js');
var testUtil = require('../unit/util.js');

var e2e = testUtil.END2END;
hfc.addConfigFile(path.join(__dirname, 'e2e', 'config.json'));
var ORGS = hfc.getConfigSetting('test-network');

var tx_id = null;
var nonce = null;
var the_user = null;

testUtil.setupChaincodeDeploy();

test('\n\n** Test chaincode install using chaincodePath to create chaincodePackage **\n\n', (t) => {
	var params = {
		org: 'org1',
		testDesc: 'using chaincodePath',
		chainName: 'testInstall',
		chaincodeId: 'install',
		chaincodePath: testUtil.CHAINCODE_PATH,
		chaincodeVersion: testUtil.getUniqueVersion(),
		chaincodePackage: ''
	};

	installChaincode(params, t)
	.then((info) => {
		if (info === 'success') {
			t.pass('success');
			t.end();
		} else {
			t.fail(info);
			t.end();
		}
	},
	(err) => {
		t.fail('install reject: '+err);
		t.end();
	}).catch((err) => {
		t.fail('install error');
		t.comment(err.stack ? err.stack : err);
		t.end();
	});
});

function installChaincode(params, t) {
	try {
		var org = params.org;
		var client = new hfc();
		var chain = client.newChain(params.chainName);

		var caRootsPath = ORGS.orderer.tls_cacerts;
		let data = fs.readFileSync(path.join(__dirname, 'e2e', caRootsPath));
		let caroots = Buffer.from(data).toString();

		chain.addOrderer(
			new Orderer(
				ORGS.orderer.url,
				{
					'pem': caroots,
					'ssl-target-name-override': ORGS.orderer['server-hostname']
				}
			)
		);

		var orgName = ORGS[org].name;

		var targets = [];
		for (let key in ORGS[org]) {
			if (ORGS[org].hasOwnProperty(key)) {
				if (key.indexOf('peer') === 0) {
					let data = fs.readFileSync(path.join(__dirname, 'e2e', ORGS[org][key]['tls_cacerts']));
					let peer = new Peer(
						ORGS[org][key].requests,
						{
							pem: Buffer.from(data).toString(),
							'ssl-target-name-override': ORGS[org][key]['server-hostname']
						});
					targets.push(peer);
					chain.addPeer(peer);
				}
			}
		}

		return hfc.newDefaultKeyValueStore({
			path: testUtil.storePathForOrg(orgName)
		}).then((store) => {
			client.setStateStore(store);
			console.log('+++++++++++++client info++++++++++++++++++++++++');
			console.log(client);
			console.log('++++++++++++client info end++++++++++++++++++++');
			var obj = testUtil.getCustomSubmitter('user7', 'KEmryLraBCJO', client, t, false , org);
			//var obj = testUtil.getSubmitter(client, t, org);
			console.log('+++++++++++++++++++++++++++++');
			console.log(obj);
			return obj;
		}).then((admin) => {
			t.pass(params.testDesc+' - Successfully enrolled user \'admin\'');
			the_user = admin;

			nonce = utils.getNonce();
			tx_id = chain.buildTransactionID(nonce, the_user);

			// send proposal to endorser
			var request = {
				targets: targets,
				chaincodePath: params.chaincodePath,
				chaincodeId: params.chaincodeId,
				chaincodeVersion: params.chaincodeVersion,
				chaincodePackage: params.chaincodePackage,
				txId: tx_id,
				nonce: nonce
			};

			return chain.sendInstallProposal(request);
		},
		(err) => {
			t.fail(params.testDesc+' - Failed to enroll user \'admin\'. ' + err);
			throw new Error(params.testDesc+' - Failed to enroll user \'admin\'. ' + err);
		}).then((results) => {
			var proposalResponses = results[0];

			var proposal = results[1];
			var header   = results[2];
			var all_good = true;
			var error = null;
			for(var i in proposalResponses) {
				let one_good = false;
				if (proposalResponses && proposalResponses[0].response && proposalResponses[0].response.status === 200) {
					one_good = true;
					logger.info(params.testDesc+' - install proposal was good');
				} else {
					logger.error(params.testDesc+' - install proposal was bad');
					error = proposalResponses[i];
				}
				all_good = all_good & one_good;
			}
			if (all_good) {
				t.comment(params.testDesc+' - Successfully sent install Proposal and received ProposalResponse');
				return 'success';
			} else {
				t.comment(params.testDesc+' - Failed to send install Proposal or receive valid response. Response null or status is not 200.');
				if (error) {
					if (typeof error === 'Error') return new Error(error.stack ? error.stack : error);
					return error;
				}
				else return 'fail';
			}
		},
		(err) => {
			t.comment(params.testDesc+' - Error in sendInstallProposal');
			return new Error(err.stack ? err.stack : err);
		});
	} catch (err) {
		t.comment(params.testDesc+' - Error in install function');
		return Promise.reject(new Error(err.stack ? err.stack : err));
	};
}

