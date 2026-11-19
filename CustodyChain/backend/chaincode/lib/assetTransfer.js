'use strict';

const stringify  = require('json-stringify-deterministic');
const sortKeysRecursive  = require('sort-keys-recursive');
const { Contract } = require('fabric-contract-api');

class AssetTransfer extends Contract {

    _getTxTimestampString(ctx) {
        const timestamp = ctx.stub.getTxTimestamp();
        const sec = timestamp && timestamp.seconds ? (timestamp.seconds.low !== undefined ? timestamp.seconds.low : Number(timestamp.seconds)) : 0;
        const nanos = timestamp && timestamp.nanos ? Number(timestamp.nanos) : 0;
        return new Date(sec * 1000 + Math.round(nanos / 1000000)).toISOString();
    }

    async InitLedger(ctx) {
        const initTime = this._getTxTimestampString(ctx);
        const assets = [
            {
                ID: '1',
                Who: 'Tomoko',
                What: 'Initial storage',
                When: initTime,
                Where: 'Location A',
                Why: 'Initial storage of the evidence',
                How: 'Sealed bag',
            },
        ];

        for (const asset of assets) {
            asset.docType = 'asset';
            await ctx.stub.putState(asset.ID, Buffer.from(stringify(sortKeysRecursive(asset))));
        }
    }

    async GetAllAssets(ctx) {
        const allResults = [];
        // range query with empty string for startKey and endKey does an open-ended query of all assets in the chaincode namespace.
        const iterator = await ctx.stub.getStateByRange('', '');
        let result = await iterator.next();
        while (!result.done) {
            const strValue = Buffer.from(result.value.value.toString()).toString('utf8');
            let record;
            try {
                record = JSON.parse(strValue);
            } catch (err) {
                console.log(err);
                record = strValue;
            }
            allResults.push(record);
            result = await iterator.next();
        }
        return JSON.stringify(allResults);
    }


    async CreateAsset(ctx, id, who, what, when, where, why, how) {
        const exists = await this.AssetExists(ctx, id);
        if (exists) {
            throw new Error(`The asset ${id} already exists`);
        }

        const timestamp = when || this._getTxTimestampString(ctx);
        const asset = { ID: id, Who: who, What: what, When: timestamp, Where: where, Why: why, How: how };
        await ctx.stub.putState(id, Buffer.from(stringify(sortKeysRecursive(asset))));
        return JSON.stringify(asset);
    }

    async UpdateAsset(ctx, id, who, what, when, where, why, how) {
        const exists = await this.AssetExists(ctx, id);
        if (!exists) {
            throw new Error(`The asset ${id} does not exist`);
        }

        const timestamp = when || this._getTxTimestampString(ctx);
        const updatedAsset = { ID: id, Who: who, What: what, When: timestamp, Where: where, Why: why, How: how };
        await ctx.stub.putState(id, Buffer.from(stringify(sortKeysRecursive(updatedAsset))));
        return JSON.stringify(updatedAsset);
    }

    async TransferAsset(ctx, id, newOwner) {
      const exists = await this.AssetExists(ctx, id);
      if (!exists) {
        throw new Error(`The asset ${id} does not exist`);
      }

      const assetJSON = await ctx.stub.getState(id);
      const asset = JSON.parse(assetJSON.toString());

      asset.Who = newOwner;
      asset.When = this._getTxTimestampString(ctx);

      await ctx.stub.putState(id, Buffer.from(stringify(sortKeysRecursive(asset))));
      return JSON.stringify(asset);
    }

    async GetAssetHistory(ctx, id) {
        const exists = await this.AssetExists(ctx, id);
        if (!exists) {
            throw new Error(`The asset ${id} does not exist`);
        }

        const historyIterator = await ctx.stub.getHistoryForKey(id);
        const history = [];
        let result = await historyIterator.next();
        while (!result.done) {
            if (result.value) {
                let timestampStr = '';
                if (result.value.timestamp) {
                    const sec = result.value.timestamp.seconds ? (result.value.timestamp.seconds.low !== undefined ? result.value.timestamp.seconds.low : Number(result.value.timestamp.seconds)) : 0;
                    const nanos = result.value.timestamp.nanos ? Number(result.value.timestamp.nanos) : 0;
                    timestampStr = new Date(sec * 1000 + Math.round(nanos / 1000000)).toISOString();
                }

                const item = {
                    txId: result.value.txId,
                    timestamp: timestampStr,
                    isDelete: result.value.isDelete,
                    value: null
                };
                try {
                    item.value = JSON.parse(result.value.value.toString('utf8'));
                } catch (err) {
                    item.value = result.value.value.toString('utf8');
                }
                history.push(item);
            }
            result = await historyIterator.next();
        }
        await historyIterator.close();
        return JSON.stringify(history);
    }

    async AssetExists(ctx, id) {
        const assetJSON = await ctx.stub.getState(id);
        return assetJSON && assetJSON.length > 0;
    }

}

module.exports = AssetTransfer;
