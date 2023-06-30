import { Agent } from 'https';
import { IAudioMetadata, parseFile } from 'music-metadata';
import axios from 'axios';
import qs from 'qs';
import {
  MAX_WAIT_TIME,
  RECOGNITION_POLLING_DELAY,
  SPEECH_BASE_URL,
  SPEECH_TOKEN_URL,
  TOKEN_SCOPE,
} from './constants';
import uuid from 'uuid';
import {
  SupportedAudioEncoding,
  SpeechToTextResult,
  SberSaluteToken,
  FileUploadResponse,
  RecognitionResponse,
  RecognitionResultResponse,
  RecognitionStatusResponse,
} from './types';

export interface ISberSaluteSpeechRecognitionService {
  speechToText(
    audioPath: string,
    encoding: SupportedAudioEncoding
  ): Promise<SpeechToTextResult>;
}

export class SberSaluteSpeechRecognitionService
  implements ISberSaluteSpeechRecognitionService
{
  private readonly authKey: string;
  private token: SberSaluteToken | null = null;
  private readonly sessionId: string;

  constructor(authKey: string, sessionId?: string) {
    this.authKey = authKey;
    this.sessionId = sessionId || uuid.v4();
  }

  private async updateAccessToken() {
    const data = qs.stringify({
      scope: TOKEN_SCOPE,
    });

    const response = await axios({
      url: SPEECH_TOKEN_URL,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        RqUID: this.sessionId,
        Authorization: `Basic ${this.authKey}`,
      },
      httpsAgent: new Agent({
        rejectUnauthorized: false,
      }),
      data,
    });

    this.token = response.data;
  }

  private async getAccessToken(): Promise<SberSaluteToken> {
    if (!this.token || this.token.expires_at < Date.now() - MAX_WAIT_TIME) {
      await this.updateAccessToken();
    }

    if (!this.token) {
      throw new Error('Failed to get access token');
    }

    return this.token;
  }

  private async uploadFileForRecognition(
    audioFilePath: string
  ): Promise<FileUploadResponse> {
    const { access_token } = await this.getAccessToken();
    const response = await axios.request({
      method: 'post',
      maxBodyLength: Infinity,
      url: `${SPEECH_BASE_URL}/data:upload`,
      headers: {
        Authorization: `Bearer ${access_token}`,
        'Content-Type': 'audio/mpeg',
      },
      data: audioFilePath,
      httpsAgent: new Agent({
        rejectUnauthorized: false,
      }),
    });
    return response.data as FileUploadResponse;
  }

  private async startRecognition(
    uploadedFile: FileUploadResponse,
    fileMetadata: IAudioMetadata,
    encoding: SupportedAudioEncoding
  ): Promise<RecognitionResponse> {
    const data = JSON.stringify({
      options: {
        model: 'general',
        audio_encoding: encoding,
        sample_rate: fileMetadata.format.sampleRate,
        channels_count: fileMetadata.format.numberOfChannels,
      },
      request_file_id: uploadedFile.result.request_file_id,
    });

    const { access_token } = await this.getAccessToken();

    const response = await axios.request({
      method: 'post',
      maxBodyLength: Infinity,
      url: `${SPEECH_BASE_URL}/speech:async_recognize`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${access_token}`,
      },
      data: data,
      httpsAgent: new Agent({
        rejectUnauthorized: false,
      }),
    });
    return response.data as RecognitionResponse;
  }

  private async getRecognitionStatus(
    recognition: RecognitionResponse
  ): Promise<RecognitionStatusResponse> {
    const { access_token } = await this.getAccessToken();

    const response = await axios.request({
      method: 'get',
      maxBodyLength: Infinity,
      url: `${SPEECH_BASE_URL}/task:get?id=${recognition.result.id}`,
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
      httpsAgent: new Agent({
        rejectUnauthorized: false,
      }),
    });
    return response.data as RecognitionStatusResponse;
  }

  private async getRecognitionResult(
    recognition: RecognitionStatusResponse
  ): Promise<RecognitionResultResponse> {
    const { access_token } = await this.getAccessToken();

    const response = await axios.request({
      method: 'get',
      maxBodyLength: Infinity,
      url: `${SPEECH_BASE_URL}/data:download?response_file_id=${recognition.result.response_file_id}`,
      headers: {
        Authorization: `Bearer ${access_token}`,
      },
      httpsAgent: new Agent({
        rejectUnauthorized: false,
      }),
    });

    return response.data as RecognitionResultResponse;
  }

  private async delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async speechToText(
    audioPath: string,
    encoding: SupportedAudioEncoding
  ): Promise<SpeechToTextResult> {
    const metadata = await parseFile(audioPath);
    const fileUploadResponse = await this.uploadFileForRecognition(audioPath);
    const recognitionResponse = await this.startRecognition(
      fileUploadResponse,
      metadata,
      encoding
    );

    const startTime = Date.now();

    let recognitionStatus = await this.getRecognitionStatus(
      recognitionResponse
    );

    while (recognitionStatus.result.status !== 'DONE') {
      if (Date.now() - startTime > MAX_WAIT_TIME) {
        throw new Error('Recognition timeout');
      }

      await this.delay(RECOGNITION_POLLING_DELAY);
      recognitionStatus = await this.getRecognitionStatus(recognitionResponse);
    }

    const recognitionResult = await this.getRecognitionResult(
      recognitionStatus
    );
    const text = recognitionResult
      .reduce((acc, item) => {
        return (
          acc + item.results.reduce((acc, item) => acc + ' ' + item.text, '')
        );
      }, '')
      .trim();
    const normalizedText = recognitionResult
      .reduce((acc, item) => {
        return (
          acc +
          item.results.reduce(
            (acc, item) => acc + ' ' + item.normalized_text,
            ''
          )
        );
      }, '')
      .trim();

    return {
      text,
      normalizedText,
    };
  }
}
