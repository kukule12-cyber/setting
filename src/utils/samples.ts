export interface SamplePhotoOption {
  id: string;
  label: string;
  caption: string;
  url: string;
  fileName: string;
}

export const SAMPLE_PHOTOS: SamplePhotoOption[] = [
  {
    id: 'architecture',
    label: '모던 건축 파빌리온',
    caption: '16:9 와이드 사진',
    url: '/src/assets/images/sample_architecture_1795674926355.jpg',
    fileName: 'architecture-pavilion.jpg',
  },
  {
    id: 'ceramic',
    label: '스튜디오 세라믹 화병',
    caption: '4:3 제품 사진',
    url: '/src/assets/images/sample_ceramic_studio_1795674926020.jpg',
    fileName: 'ceramic-studio.jpg',
  },
  {
    id: 'mountain',
    label: '새벽 안개 설산 능선',
    caption: '3:4 세로 풍경',
    url: '/src/assets/images/sample_mountain_mist_1795674927074.jpg',
    fileName: 'alpine-mist.jpg',
  },
];
