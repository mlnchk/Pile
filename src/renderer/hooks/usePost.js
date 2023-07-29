import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePilesContext } from 'renderer/context/PilesContext';
import * as fileOperations from '../utils/fileOperations';
import { useIndexContext } from 'renderer/context/IndexContext';
import {
  getPost,
  cycleColorCreator,
  tagActionsCreator,
  attachToPostCreator,
  detachFromPostCreator,
} from './usePostHelpers';

const highlightColors = [
  'var(--border)',
  'var(--base-yellow)',
  'var(--base-green)',
];

const defaultPost = {
  content: '',
  data: {
    title: '',
    createdAt: null,
    updatedAt: null,
    highlightColor: null,
    tags: [],
    replies: [],
    attachments: [],
    isReply: false,
    isAI: false,
  },
};

function usePost(
  postPath = null,
  {
    isReply = false,
    isAI = false,
    parentPostPath = null,
    reloadParentPost = () => {},
  } = {}
) {
  const { currentPile, getCurrentPilePath } = usePilesContext();
  const { addIndex, removeIndex, refreshIndex } = useIndexContext();
  const [updates, setUpdates] = useState(0);
  const [path, setPath] = useState();
  const [post, setPost] = useState({ ...defaultPost });

  useEffect(() => {
    if (!postPath) return;
    refreshPost(postPath);
    setPath(postPath);
  }, [postPath]);

  const refreshPost = useCallback(async () => {
    if (!postPath) return;
    const freshPost = await getPost(postPath);
    setPost(freshPost);
  }, [postPath]);

  const savePost = useCallback(
    async (dataOverrides) => {
      const saveToPath = path
        ? path
        : fileOperations.getFilePathForNewPost(currentPile.path);

      const directoryPath = fileOperations.getDirectoryPath(saveToPath);
      const now = new Date().toISOString();
      const content = post.content;
      const data = {
        ...post.data,
        isAI: post.data.isAI === true ? post.data.isAI : isAI,
        isReply: post.data.createdAt ? post.data.isReply : isReply,
        createdAt: post.data.createdAt ?? now,
        updatedAt: now,
        ...dataOverrides,
      };

      try {
        const fileContents = await fileOperations.generateMarkdown(
          content,
          data
        );
        await fileOperations.createDirectory(directoryPath);
        await fileOperations.saveFile(saveToPath, fileContents);

        if (isReply) {
          await addReplyToParent(parentPostPath, saveToPath);
        }

        addIndex(saveToPath); // Add the file to the index
        window.electron.ipc.invoke('tags-sync', saveToPath); // Sync tags
      } catch (error) {
        console.error(`Error writing file: ${saveToPath}`);
        console.error(error);
      }
    },
    [path, post, reloadParentPost]
  );

  const addReplyToParent = async (parentPostPath, replyPostPath) => {
    const relativeReplyPath = replyPostPath.split('/').slice(-3).join('/');
    const parentPost = await getPost(parentPostPath);
    const content = parentPost.content;
    const data = {
      ...parentPost.data,
      replies: [...parentPost.data.replies, relativeReplyPath],
    };
    const fileContents = await fileOperations.generateMarkdown(content, data);
    await fileOperations.saveFile(parentPostPath, fileContents);
    reloadParentPost(parentPostPath);
  };

  const deletePost = useCallback(async () => {
    if (!postPath) return null;

    // if is reply, remove from parent
    if (post.data.isReply && parentPostPath) {
      const parentPost = await getPost(parentPostPath);
      const content = parentPost.content;
      const newReplies = parentPost.data.replies.filter((p) => {
        return p !== postPath.split('/').slice(-3).join('/');
      });
      const data = {
        ...parentPost.data,
        replies: newReplies,
      };
      const fileContents = await fileOperations.generateMarkdown(content, data);
      await fileOperations.saveFile(parentPostPath, fileContents);
      await reloadParentPost(parentPostPath);
    }

    // delete file and remove from index
    await fileOperations.deleteFile(postPath);
    removeIndex(postPath);
  }, [postPath, reloadParentPost, parentPostPath, post]);

  const postActions = useMemo(
    () => ({
      setContent: (content) => setPost((post) => ({ ...post, content })),
      updateData: (data) =>
        setPost((post) => ({ ...post, data: { ...post.data, ...data } })),
      cycleColor: cycleColorCreator(post, setPost, savePost, highlightColors),
      addTag: tagActionsCreator(setPost, 'add'),
      removeTag: tagActionsCreator(setPost, 'remove'),
      attachToPost: attachToPostCreator(setPost, getCurrentPilePath),
      detachFromPost: detachFromPostCreator(setPost, getCurrentPilePath),
      resetPost: () => setPost(defaultPost),
    }),
    [post]
  );

  return {
    defaultPost,
    post,
    savePost,
    refreshPost,
    deletePost,
    ...postActions,
  };
}

export default usePost;