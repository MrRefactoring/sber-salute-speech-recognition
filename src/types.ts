export type SberSaluteToken = {
  access_token: string;
  expires_at: number;
};

export type FileUploadResponse = {
  result: {
    request_file_id: string;
  };
};

export type RecognitionResponse = {
  result: {
    id: string;
    created_at: string;
    updated_at: string;
    status: string;
  };
};

export type RecognitionStatusResponse = {
  result: {
    id: string;
    created_at: string;
    updated_at: string;
    status: string;
    response_file_id: string;
  };
};

export type RecognitionResultResponse = [
  {
    results: [
      {
        text: string;
        normalized_text: string;
      }
    ];
  }
];

export type SpeechToTextResult = {
  text: string;
  normalizedText: string;
};

export type ChannelsCount = 1 | 2;

export type SpeakerSeparationOptions = {
  enable?: boolean;
  enable_only_main_speaker?: boolean;
  count: 2;
};
