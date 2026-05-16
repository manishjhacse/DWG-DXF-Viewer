const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { Upload } = require('@aws-sdk/lib-storage');
const fs = require('fs');
const path = require('path');

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.S3_BUCKET_NAME;

/**
 * Upload a file or buffer to S3
 * @param {string|Buffer} data - Local file path or Buffer
 * @param {string} s3Key - S3 object key
 * @param {string} contentType - MIME type
 * @returns {Promise<string>} S3 key
 */
const uploadToS3 = async (data, s3Key, contentType = 'application/octet-stream') => {
  let body = data;

  // If data is a string, it's a file path
  if (typeof data === 'string' && fs.existsSync(data)) {
    body = fs.createReadStream(data);
  }

  const upload = new Upload({
    client: s3Client,
    params: {
      Bucket: BUCKET,
      Key: s3Key,
      Body: body,
      ContentType: contentType,
    },
  });

  await upload.done();
  return s3Key;
};

/**
 * Download a file from S3 to a local path
 * @param {string} s3Key - S3 object key
 * @param {string} destPath - Local destination path
 */
const downloadFromS3 = async (s3Key, destPath) => {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: s3Key,
  });

  const response = await s3Client.send(command);
  const writeStream = fs.createWriteStream(destPath);

  return new Promise((resolve, reject) => {
    response.Body.pipe(writeStream);
    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
  });
};

/**
 * Get data from S3 as a string
 * @param {string} s3Key - S3 object key
 * @returns {Promise<string>}
 */
const getDataFromS3 = async (s3Key) => {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: s3Key,
  });
  const response = await s3Client.send(command);
  if (!response.Body) {
    throw new Error('S3 response body is empty');
  }
  const str = await response.Body.transformToString();
  return str;
};

/**
 * Delete a file from S3
 * @param {string} s3Key - S3 object key
 */
const deleteFromS3 = async (s3Key) => {
  const command = new DeleteObjectCommand({
    Bucket: BUCKET,
    Key: s3Key,
  });
  await s3Client.send(command);
};

/**
 * Generate a presigned URL for an S3 object
 * @param {string} s3Key - S3 object key
 * @param {number} expiresIn - Expiration in seconds (default 1 hour)
 * @returns {Promise<string>}
 */
const getSignedUrlForObject = async (s3Key, expiresIn = 3600) => {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: s3Key,
  });
  return await getSignedUrl(s3Client, command, { expiresIn });
};

module.exports = { s3Client, uploadToS3, downloadFromS3, getDataFromS3, deleteFromS3, getSignedUrlForObject };
